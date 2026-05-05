import axios from "axios";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 CloneAgent/1.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const MAX_HTML_BYTES = 12_000;

function extractStructured(html) {
  const pick = (re, group = 1) => {
    const m = html.match(re);
    return m ? m[group].replace(/\s+/g, " ").trim() : "";
  };
  const all = (re, group = 1, limit = 25) => {
    const out = [];
    let m;
    while ((m = re.exec(html)) && out.length < limit) {
      const v = m[group].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (v && !out.includes(v)) out.push(v);
    }
    return out;
  };

  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = pick(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  );
  const ogTitle = pick(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  );
  const h1 = all(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, 1, 5);
  const h2 = all(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, 1, 15);
  const h3 = all(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, 1, 15);
  const buttons = all(/<button[^>]*>([\s\S]*?)<\/button>/gi, 1, 20);
  const navLinks = all(
    /<nav[^>]*>[\s\S]*?<\/nav>/gi,
    0,
    3
  )
    .flatMap((nav) =>
      [...nav.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((m) =>
        m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      )
    )
    .filter((s, i, arr) => s && s.length < 40 && arr.indexOf(s) === i)
    .slice(0, 25);
  const footerLinks = all(
    /<footer[^>]*>[\s\S]*?<\/footer>/gi,
    0,
    2
  )
    .flatMap((f) =>
      [...f.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((m) =>
        m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      )
    )
    .filter((s, i, arr) => s && s.length < 60 && arr.indexOf(s) === i)
    .slice(0, 40);

  return { title, description, ogTitle, h1, h2, h3, buttons, navLinks, footerLinks };
}

export async function fetchWebpage(arg) {
  const url = typeof arg === "string" ? arg : arg?.url;
  if (!url) throw new Error("fetchWebpage requires a URL string");

  const { data } = await axios.get(url, {
    headers: DEFAULT_HEADERS,
    timeout: 20_000,
    maxContentLength: 10 * 1024 * 1024,
    responseType: "text",
    transformResponse: [(d) => d],
  });

  const raw = typeof data === "string" ? data : String(data ?? "");
  const structured = extractStructured(raw);

  let stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+(class|style|data-[a-z0-9-]+|srcset|sizes|loading|decoding|fetchpriority)="[^"]*"/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/>\s+</g, "><")
    .trim();

  if (stripped.length > MAX_HTML_BYTES) {
    stripped = stripped.slice(0, MAX_HTML_BYTES) + "<!--truncated-->";
  }

  const summary = [
    `<!-- structured extract from ${url} -->`,
    `TITLE:        ${structured.title || "(none)"}`,
    `OG_TITLE:     ${structured.ogTitle || "(none)"}`,
    `DESCRIPTION:  ${structured.description || "(none)"}`,
    `H1:           ${structured.h1.join(" | ") || "(none)"}`,
    `H2:           ${structured.h2.join(" | ") || "(none)"}`,
    `H3:           ${structured.h3.join(" | ") || "(none)"}`,
    `NAV_LINKS:    ${structured.navLinks.join(" | ") || "(none)"}`,
    `BUTTONS:      ${structured.buttons.join(" | ") || "(none)"}`,
    `FOOTER_LINKS: ${structured.footerLinks.join(" | ") || "(none)"}`,
    `<!-- raw (stripped) HTML below for reference -->`,
    stripped,
  ].join("\n");

  return summary;
}

export async function getTheWeatherOfCity(arg) {
  const cityname = typeof arg === "string" ? arg : arg?.city || arg?.cityname || "";
  if (!cityname) throw new Error("getTheWeatherOfCity requires a city name");
  const url = `https://wttr.in/${encodeURIComponent(cityname.toLowerCase())}?format=%C+%t`;
  const { data } = await axios.get(url, { responseType: "text", timeout: 15_000 });
  return `The Weather of ${cityname} is ${String(data).trim()}`;
}

export async function getGithubDetailsAboutUser(arg) {
  const username = typeof arg === "string" ? arg : arg?.username || "";
  if (!username) throw new Error("getGithubDetailsAboutUser requires a username");
  const { data } = await axios.get(`https://api.github.com/users/${encodeURIComponent(username)}`, {
    timeout: 15_000,
  });
  return {
    login: data.login,
    name: data.name,
    blog: data.blog,
    public_repos: data.public_repos,
  };
}
