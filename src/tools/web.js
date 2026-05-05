import axios from "axios";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 CloneAgent/1.0",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const MAX_HTML_BYTES = 60_000;

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

  let html = typeof data === "string" ? data : String(data ?? "");

  const nextDataMatch = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  const nextDataBlock = nextDataMatch ? nextDataMatch[0] : "";

  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  if (nextDataBlock) {
    let nextJson = nextDataBlock.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");
    if (nextJson.length > 20_000) nextJson = nextJson.slice(0, 20_000) + "...[truncated]";
    html += `\n\n<!-- __NEXT_DATA__ JSON (parse for SPA content) -->\n${nextJson}`;
  }

  if (html.length > MAX_HTML_BYTES) {
    html = html.slice(0, MAX_HTML_BYTES) + "\n<!-- ...truncated for token budget -->";
  }
  return html;
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
