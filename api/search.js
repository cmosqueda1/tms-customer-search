// api/search.js
// Vercel serverless function: login -> search_location_master_v2 -> return mapped items
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // --- read input (JSON or form) ---
    let searchInput = "";
    const ct = req.headers["content-type"] || "";
    if (ct.includes("application/json")) {
      searchInput = (req.body?.search_name || req.body?.search_term || "").toString().trim();
    } else {
      const raw = req.body ? req.body.toString() : "";
      const p = new URLSearchParams(raw);
      searchInput = (p.get("search_name") || p.get("search_term") || "").toString().trim();
    }

    if (searchInput.length < 3) {
      return res.status(400).json({ error: "search term must be at least 3 characters" });
    }

    const username = process.env.TMS_USERNAME;
    const password = process.env.TMS_PASSWORD; // pass exactly what the TMS expects
    if (!username || !password) {
      return res.status(500).json({ error: "Server missing TMS credentials" });
    }

    // --- 1) LOGIN ---
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

    // collect session cookies for the follow-up request
    const cookieHeader =
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

    // --- 2) SEARCH via search_location_master_v2.php ---
    // required payload (from your example)
    const searchBody = new URLSearchParams({
      search_term: searchInput,
      input_inactive: "0",
      carrieronly: "0",
      billto: "1",
      terminalonly: "0",
      UserID: String(userId),
      UserToken: String(userToken),
      pageName: "dashboardCustomerSetup"
    });

    const searchResp = await fetch(
      "https://tms.freightapp.com/write_new/search_location_master_v2.php",
      {
        method: "POST",
        headers: {
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "en-US,en;q=0.9",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Origin": "https://tms.freightapp.com",
          "Referer": "https://tms.freightapp.com/dev.html",
          "X-Requested-With": "XMLHttpRequest",
          ...(cookieHeader ? { Cookie: cookieHeader } : {})
        },
        body: searchBody.toString()
      }
    );

    const searchText = await searchResp.text();
    let data;
    try {
      data = JSON.parse(searchText);
    } catch {
      return res.status(502).json({ error: "Search did not return JSON", raw: searchText });
    }

    // Flexible extraction: v2 may return array or object with a key
    const rows = Array.isArray(data)
      ? data
      : data.locations || data.results || data.items || [];

    const items = rows.map((x) => ({
      location_name: x.location_name ?? x.name ?? "",
      location_code: x.location_code ?? x.code ?? "",
      location_city: x.location_city ?? x.city ?? "",
      location_id: x.location_id ?? x.id ?? ""
    }));

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ count: items.length, items });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
