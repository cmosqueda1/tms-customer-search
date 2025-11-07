// api/search.js
// Vercel serverless function: logs in, then searches customers in one request.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // read body (JSON or form)
    let search_name = "";
    if (req.headers["content-type"]?.includes("application/json")) {
      search_name = (req.body?.search_name || "").toString().trim();
    } else {
      const text = req.body ? req.body.toString() : "";
      const params = new URLSearchParams(text);
      search_name = (params.get("search_name") || "").toString().trim();
    }
    if (search_name.length < 3) {
      return res.status(400).json({ error: "search_name must be at least 3 characters" });
    }

    const username = process.env.TMS_USERNAME;
    const password = process.env.TMS_PASSWORD; // pass exactly what your login expects
    if (!username || !password) {
      return res.status(500).json({ error: "Server missing TMS credentials" });
    }

    // 1) LOGIN
    const loginBody = new URLSearchParams({
      username,
      password,
      UserID: "null",
      UserToken: "null",
      pageName: "/index.html"
    });

    const loginResp = await fetch("https://tms.freightapp.com/write/check_login.php", {
      method: "POST",
      headers: {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin": "https://tms.freightapp.com",
        "Referer": "https://tms.freightapp.com/index.html",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: loginBody.toString()
    });

    // capture session cookie(s)
    const setCookie =
      loginResp.headers.get("set-cookie") ||
      (loginResp.headers.getSetCookie ? loginResp.headers.getSetCookie().join("; ") : "");

    const loginText = await loginResp.text();
    let loginJson;
    try {
      loginJson = JSON.parse(loginText);
    } catch {
      return res.status(502).json({ error: "Login did not return JSON", raw: loginText });
    }
    const userId = loginJson?.UserID || "";
    const userToken = loginJson?.UserToken || "";
    if (!userId || !userToken) {
      return res.status(401).json({ error: "Missing UserID/UserToken", raw: loginJson });
    }

    // 2) SEARCH (customer/location search) — includes required flags
    const searchBody = new URLSearchParams({
      search_name,                 // user input
      // required flags
      input_billto_only: "1",
      input_inactive: "0",
      input_carrier_only: "0",
      input_terminal_only: "0",
      input_search_group: "0",
      // (keep these blank unless you want to search by them specifically)
      search_code: "",
      search_id: "",
      // auth + page
      UserID: userId,
      UserToken: userToken,
      pageName: "dashboardCustomerSetup"
    });

    const searchResp = await fetch(
      "https://tms.freightapp.com/write_new/search_location_setup.php",
      {
        method: "POST",
        headers: {
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "en-US,en;q=0.9",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Origin": "https://tms.freightapp.com",
          "Referer": "https://tms.freightapp.com/dev.html",
          "X-Requested-With": "XMLHttpRequest",
          ...(setCookie ? { Cookie: setCookie } : {})
        },
        body: searchBody.toString()
      }
    );

    const searchText = await searchResp.text();
    let searchJson;
    try {
      searchJson = JSON.parse(searchText);
    } catch {
      return res.status(502).json({ error: "Search did not return JSON", raw: searchText });
    }

    const items = (searchJson.locations || []).map(x => ({
      location_name: x.location_name,
      location_code: x.location_code,
      location_city: x.location_city,
      location_id: x.location_id
    }));

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ count: items.length, items });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
