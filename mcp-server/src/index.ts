#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.BREWPAGE_URL || "https://brewpage.app";

const server = new McpServer({
  name: "brewpage-mcp",
  version: "1.5.0",
});

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function formatPublishResponse(data: Record<string, unknown>): string {
  const lines = [
    `Published successfully!`,
    ``,
    `URL: ${data.url || data.link || "N/A"}`,
  ];
  if (data.shortUrl) lines.push(`Short URL: ${data.shortUrl}`);
  lines.push(
    `Namespace: ${data.namespace || "N/A"}`,
    `ID: ${data.id || "N/A"}`
  );
  if (data.expiresAt) lines.push(`Expires: ${data.expiresAt}`);
  lines.push(
    ``,
    `===================================`,
    `OWNER TOKEN: ${data.ownerToken}`,
    `===================================`,
    ``,
    `IMPORTANT: Save your owner token! You need it to update or delete this resource later. It cannot be recovered if lost.`
  );
  return lines.join("\n");
}

function formatUpdateResponse(data: Record<string, unknown>): string {
  const lines = [
    `Updated successfully!`,
    ``,
    `URL: ${data.url || data.link || "N/A"}`,
  ];
  if (data.shortUrl) lines.push(`Short URL: ${data.shortUrl}`);
  lines.push(
    `Namespace: ${data.namespace || "N/A"}`,
    `ID: ${data.id || "N/A"}`
  );
  if (data.expiresAt) lines.push(`Expires: ${data.expiresAt}`);
  if (data.updatedAt) lines.push(`Updated: ${data.updatedAt}`);
  return lines.join("\n");
}

server.tool(
  "publish_html",
  "Publish HTML or Markdown content to BrewPage. Returns a public URL and owner token. Supports password protection, custom TTL, optional filename, and an opt-in top toolbar (showTopBar).",
  {
    content: z.string().describe("HTML or Markdown content to publish"),
    format: z
      .enum(["HTML", "MARKDOWN"])
      .default("HTML")
      .describe("Content format: HTML or MARKDOWN"),
    namespace: z
      .string()
      .optional()
      .describe("Namespace for the page (optional, defaults to 'public')"),
    password: z
      .string()
      .optional()
      .describe("Optional password to protect the page"),
    ttlDays: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Time to live in days (1-30, default: 15)"),
    filename: z
      .string()
      .max(200)
      .optional()
      .describe("Optional original filename (≤200 chars). Used as title fallback when no <title>/<h1>; immutable on update."),
    showTopBar: z
      .boolean()
      .optional()
      .describe("Add a thin top toolbar (filename + Download button + theme toggle) on the served page. Default: hidden."),
  },
  async ({ content, format, namespace, password, ttlDays, filename, showTopBar }) => {
    const body: Record<string, unknown> = { content, format };
    if (namespace) body.namespace = namespace;
    if (password) body.password = password;
    if (ttlDays) body.ttlDays = ttlDays;
    if (filename) body.filename = filename;
    if (showTopBar !== undefined) body.showTopBar = showTopBar;

    const { ok, data } = await apiRequest("POST", "/api/html", body);

    if (!ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to publish: ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatPublishResponse(data as Record<string, unknown>),
        },
      ],
    };
  }
);

server.tool(
  "publish_file",
  "Upload a file to BrewPage via URL. Returns a public URL and owner token.",
  {
    url: z.string().url().describe("URL of the file to upload"),
    namespace: z
      .string()
      .optional()
      .describe("Namespace for the file (optional, defaults to 'public')"),
    filename: z.string().optional().describe("Custom filename (optional)"),
  },
  async ({ url: fileUrl, namespace, filename }) => {
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to fetch file from URL: ${fileRes.status} ${fileRes.statusText}`,
          },
        ],
        isError: true,
      };
    }

    const blob = await fileRes.blob();
    const formData = new FormData();
    formData.append(
      "file",
      blob,
      filename || fileUrl.split("/").pop() || "file"
    );
    if (namespace) formData.append("namespace", namespace);

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to upload file: ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatPublishResponse(data as Record<string, unknown>),
        },
      ],
    };
  }
);

server.tool(
  "delete_resource",
  "Delete a BrewPage resource (HTML page, KV store, JSON collection, or file) using the owner token.",
  {
    type: z
      .enum(["html", "kv", "json", "file"])
      .describe("Resource type to delete"),
    namespace: z.string().describe("Resource namespace"),
    id: z.string().describe("Resource ID"),
    ownerToken: z
      .string()
      .describe(
        "Owner token received when the resource was created"
      ),
  },
  async ({ type, namespace, id, ownerToken }) => {
    const pathMap: Record<string, string> = {
      html: `/api/html/${namespace}/${id}`,
      kv: `/api/kv/${namespace}/${id}`,
      json: `/api/json/${namespace}/${id}`,
      file: `/api/files/${namespace}/${id}`,
    };

    const { ok, status, data } = await apiRequest(
      "DELETE",
      pathMap[type],
      undefined,
      { "X-Owner-Token": ownerToken }
    );

    if (!ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to delete (${status}): ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Successfully deleted ${type} resource: ${namespace}/${id}`,
        },
      ],
    };
  }
);

server.tool(
  "get_page",
  "Fetch a published BrewPage HTML page content by namespace and ID.",
  {
    namespace: z.string().describe("Page namespace"),
    id: z.string().describe("Page ID"),
    password: z
      .string()
      .optional()
      .describe("Password if the page is protected"),
  },
  async ({ namespace, id, password }) => {
    const headers: Record<string, string> = {};
    if (password) headers["X-Password"] = password;

    const { ok, status, data } = await apiRequest(
      "GET",
      `/api/html/${namespace}/${id}`,
      undefined,
      headers
    );

    if (!ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to fetch page (${status}): ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    const page = data as Record<string, unknown>;
    const lines = [
      `Page: ${namespace}/${id}`,
      `URL: ${page.url || `${BASE_URL}/${namespace}/${id}`}`,
      `Format: ${page.format || "HTML"}`,
      `Created: ${page.createdAt || "N/A"}`,
      ``,
      `--- Content ---`,
      `${page.content || ""}`,
    ];

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

server.tool(
  "get_stats",
  "Get BrewPage platform-wide usage statistics including page count, file count, and storage usage. Counts use disjoint split: alive_public + alive_private + deleted == total. Optional `tz` shifts the 'today' boundary to the given IANA zone (default UTC).",
  {
    tz: z
      .string()
      .optional()
      .describe(
        "Optional IANA timezone id for the 'today' boundary, e.g. 'Europe/Lisbon'. Defaults to UTC. Invalid value falls back to UTC silently."
      ),
  },
  async ({ tz }) => {
    const path = tz ? `/api/stats?tz=${encodeURIComponent(tz)}` : "/api/stats";
    const { ok, data } = await apiRequest("GET", path);

    if (!ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to fetch stats: ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `BrewPage Platform Statistics:\n\n${JSON.stringify(data, null, 2)}`,
        },
      ],
    };
  }
);

server.tool(
  "publish_site",
  "Publish an HTML site to BrewPage. Single-page: pass `entryContent`. Multi-page: pass `files` (array of `{path, content}`). Optional `entry` overrides default `index.html`.",
  {
    entryContent: z
      .string()
      .optional()
      .describe("HTML content for a single-page site (entry file). Mutually exclusive with `files`."),
    files: z
      .array(z.object({ path: z.string(), content: z.string() }))
      .optional()
      .describe("Multi-file site: array of `{path, content}`. Mutually exclusive with `entryContent`."),
    entry: z
      .string()
      .optional()
      .describe("Entry file path, default index.html"),
    namespace: z
      .string()
      .optional()
      .describe("Namespace for the site (optional, defaults to 'public')"),
    password: z
      .string()
      .optional()
      .describe("Optional password to protect the site"),
    ttlDays: z
      .number()
      .min(1)
      .max(30)
      .optional()
      .describe("Time to live in days (1-30, default: 15)"),
    ownerToken: z
      .string()
      .optional()
      .describe("Existing owner token to group this site under the same owner as previous content"),
  },
  async ({ entryContent, files, entry, namespace, password, ttlDays, ownerToken }) => {
    const hasEntry = typeof entryContent === "string";
    const hasFiles = Array.isArray(files) && files.length > 0;
    if (hasEntry === hasFiles) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Provide exactly one of `entryContent` (single-page) or `files` (multi-page).",
          },
        ],
        isError: true,
      };
    }

    const formData = new FormData();
    if (hasFiles) {
      for (const f of files!) {
        formData.append("files", new Blob([f.content], { type: "text/html" }), f.path);
        formData.append("paths", f.path);
      }
    } else {
      const entryBlob = new Blob([entryContent!], { type: "text/html" });
      const entryName = entry || "index.html";
      formData.append("files", entryBlob, entryName);
      formData.append("paths", entryName);
    }
    const headers: Record<string, string> = {};
    if (password) headers["X-Password"] = password;
    if (ownerToken) headers["X-Owner-Token"] = ownerToken;

    const qsParams: string[] = [];
    if (entry) qsParams.push(`entry=${encodeURIComponent(entry)}`);
    if (namespace) qsParams.push(`ns=${encodeURIComponent(namespace)}`);
    if (ttlDays) qsParams.push(`ttl=${encodeURIComponent(String(ttlDays))}`);
    const qs = qsParams.length ? `?${qsParams.join("&")}` : "";
    const url = `${BASE_URL}/api/sites${qs}`;
    const res = await fetch(url, { method: "POST", headers, body: formData });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to publish site: ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    const site = data as Record<string, unknown>;
    const lines = [
      `Site published successfully!`,
      ``,
      `URL: ${site.link || "N/A"}`,
      `Namespace: ${site.namespace || "N/A"}`,
      `ID: ${site.id || "N/A"}`,
      `Entry file: ${site.entryFile || "index.html"}`,
      `Files: ${site.fileCount || 1}`,
    ];
    if (site.totalSizeBytes !== undefined) lines.push(`Size: ${site.totalSizeBytes} bytes`);
    if (site.ownerLink) lines.push(`Owner link: ${site.ownerLink}`);
    if (Array.isArray(site.tags) && site.tags.length) lines.push(`Tags: ${(site.tags as string[]).join(", ")}`);
    if (site.expiresAt) lines.push(`Expires: ${site.expiresAt}`);
    lines.push(
      ``,
      `===================================`,
      `OWNER TOKEN: ${site.ownerToken}`,
      `===================================`,
      ``,
      `IMPORTANT: Save your owner token! You need it to view info or delete this site. It cannot be recovered if lost.`
    );

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

server.tool(
  "update_html",
  "Update an existing BrewPage HTML/Markdown page. Requires owner token. Returns the updated page metadata.",
  {
    namespace: z.string().describe("Page namespace"),
    id: z.string().describe("Page ID"),
    content: z.string().describe("New HTML or Markdown content"),
    ownerToken: z
      .string()
      .describe("Owner token received when the page was created"),
    format: z
      .string()
      .optional()
      .describe(
        "Content format. Accepts (case-insensitive on html/markdown): 'html', 'markdown'/'md', or a code language — yaml, json, xml, csv, tsv, log, toml, ini, sql, sh, bat, env, javascript, typescript, tsx, jsx, css, properties, docker, txt. Omit to preserve the stored format."
      ),
  },
  async ({ namespace, id, content, ownerToken, format }) => {
    const body: Record<string, unknown> = { content };
    if (format) body.format = format;

    const path = `/api/html/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`;
    const { ok, status, data } = await apiRequest("PUT", path, body, {
      "X-Owner-Token": ownerToken,
    });

    if (!ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to update HTML (${status}): ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatUpdateResponse(data as Record<string, unknown>),
        },
      ],
    };
  }
);

server.tool(
  "publish_json",
  "Publish a JSON document to BrewPage. Accepts a JSON object, array, or a JSON-encoded string. Returns a public URL and owner token.",
  {
    json: z
      .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
      .describe("JSON document to publish (object, array, or JSON-encoded string)"),
    namespace: z
      .string()
      .optional()
      .describe("Namespace for the document (optional, defaults to 'public')"),
    password: z
      .string()
      .optional()
      .describe("Optional password to protect the document"),
    ttlDays: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Time to live in days (1-30, default: 15)"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Optional tags for the document"),
    ownerToken: z
      .string()
      .optional()
      .describe("Existing owner token to group this document under the same owner as previous content"),
  },
  async ({ json, namespace, password, ttlDays, tags, ownerToken }) => {
    const jsonString = typeof json === "string" ? json : JSON.stringify(json);

    const qsParams: string[] = [];
    if (namespace) qsParams.push(`ns=${encodeURIComponent(namespace)}`);
    if (ttlDays !== undefined) qsParams.push(`ttl=${encodeURIComponent(String(ttlDays))}`);
    if (tags && tags.length) {
      for (const t of tags) qsParams.push(`tags=${encodeURIComponent(t)}`);
    }
    const qs = qsParams.length ? `?${qsParams.join("&")}` : "";

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (password) headers["X-Password"] = password;
    if (ownerToken) headers["X-Owner-Token"] = ownerToken;

    const res = await fetch(`${BASE_URL}/api/json${qs}`, {
      method: "POST",
      headers,
      body: jsonString,
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to publish JSON (${res.status}): ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatPublishResponse(data as Record<string, unknown>),
        },
      ],
    };
  }
);

server.tool(
  "get_json",
  "Fetch a published BrewPage JSON document by namespace and ID.",
  {
    namespace: z.string().describe("Document namespace"),
    id: z.string().describe("Document ID"),
    password: z
      .string()
      .optional()
      .describe("Password if the document is protected"),
  },
  async ({ namespace, id, password }) => {
    const headers: Record<string, string> = {};
    if (password) headers["X-Password"] = password;

    const path = `/api/json/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`;
    const { ok, status, data } = await apiRequest(
      "GET",
      path,
      undefined,
      headers
    );

    if (!ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to fetch JSON (${status}): ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "update_json",
  "Update an existing BrewPage JSON document. Requires owner token. Accepts a JSON object, array, or a JSON-encoded string.",
  {
    namespace: z.string().describe("Document namespace"),
    id: z.string().describe("Document ID"),
    json: z
      .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
      .describe("New JSON document (object, array, or JSON-encoded string)"),
    ownerToken: z
      .string()
      .describe("Owner token received when the document was created"),
  },
  async ({ namespace, id, json, ownerToken }) => {
    const jsonString = typeof json === "string" ? json : JSON.stringify(json);

    const url = `${BASE_URL}/api/json/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Owner-Token": ownerToken,
      },
      body: jsonString,
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to update JSON (${res.status}): ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatUpdateResponse(data as Record<string, unknown>),
        },
      ],
    };
  }
);

server.tool(
  "publish_kv",
  "Publish a key/value entry to BrewPage. Creates a KV store; the entry is addressed by (namespace, id, key). Returns a public URL and owner token.",
  {
    key: z.string().describe("KV key (first part of the (namespace, id, key) addressing tuple)"),
    value: z.string().describe("KV value"),
    namespace: z
      .string()
      .optional()
      .describe("Namespace for the KV store (optional, defaults to 'public')"),
    password: z
      .string()
      .optional()
      .describe("Optional password to protect the KV store"),
    ttlDays: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Time to live in days (1-30, default: 15)"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Optional tags for the KV entry"),
    ownerToken: z
      .string()
      .optional()
      .describe("Existing owner token to group this KV store under the same owner as previous content"),
  },
  async ({ key, value, namespace, password, ttlDays, tags, ownerToken }) => {
    const body: Record<string, unknown> = { key, value };

    const qsParams: string[] = [];
    if (namespace) qsParams.push(`ns=${encodeURIComponent(namespace)}`);
    if (ttlDays !== undefined) qsParams.push(`ttl=${encodeURIComponent(String(ttlDays))}`);
    if (tags && tags.length) {
      for (const t of tags) qsParams.push(`tags=${encodeURIComponent(t)}`);
    }
    const qs = qsParams.length ? `?${qsParams.join("&")}` : "";

    const headers: Record<string, string> = {};
    if (password) headers["X-Password"] = password;
    if (ownerToken) headers["X-Owner-Token"] = ownerToken;

    const { ok, status, data } = await apiRequest(
      "POST",
      `/api/kv${qs}`,
      body,
      headers
    );

    if (!ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to publish KV (${status}): ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatPublishResponse(data as Record<string, unknown>),
        },
      ],
    };
  }
);

server.tool(
  "set_kv",
  "Set or update a key in an existing BrewPage KV store. Requires owner token.",
  {
    namespace: z.string().describe("KV store namespace"),
    id: z.string().describe("KV store ID"),
    key: z.string().describe("Key to set"),
    value: z.string().describe("Value to assign to the key"),
    ownerToken: z
      .string()
      .describe("Owner token received when the KV store was created"),
  },
  async ({ namespace, id, key, value, ownerToken }) => {
    const body: Record<string, unknown> = { value };

    const path = `/api/kv/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/${encodeURIComponent(key)}`;
    const { ok, status, data } = await apiRequest("PUT", path, body, {
      "X-Owner-Token": ownerToken,
    });

    if (!ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to set KV (${status}): ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatUpdateResponse(data as Record<string, unknown>),
        },
      ],
    };
  }
);

server.tool(
  "get_kv",
  "Fetch a value from a BrewPage KV store by namespace, ID, and key.",
  {
    namespace: z.string().describe("KV store namespace"),
    id: z.string().describe("KV store ID"),
    key: z.string().describe("Key to fetch"),
    password: z
      .string()
      .optional()
      .describe("Password if the KV store is protected"),
  },
  async ({ namespace, id, key, password }) => {
    const headers: Record<string, string> = {};
    if (password) headers["X-Password"] = password;

    const path = `/api/kv/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/${encodeURIComponent(key)}`;
    const { ok, status, data } = await apiRequest(
      "GET",
      path,
      undefined,
      headers
    );

    if (!ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to fetch KV (${status}): ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "search_gallery",
  "Search the BrewPage public gallery. Optional filters: text query, pagination, sort, and 'mine' (owner-scoped, requires owner token).",
  {
    q: z.string().optional().describe("Free-text search query"),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe("Page number (1-based; default 1)"),
    size: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Page size (1-100; backend caps at 100)"),
    sort: z
      .enum(["date", "views"])
      .optional()
      .describe("Sort order: 'date' or 'views'"),
    mine: z
      .boolean()
      .optional()
      .describe("If true, restricts results to entries owned by the supplied owner token"),
    ownerToken: z
      .string()
      .optional()
      .describe("Owner token; only sent as X-Owner-Token when 'mine' is true"),
  },
  async ({ q, page, size, sort, mine, ownerToken }) => {
    const qsParams: string[] = [];
    if (q !== undefined) qsParams.push(`q=${encodeURIComponent(q)}`);
    if (page !== undefined) qsParams.push(`page=${encodeURIComponent(String(page))}`);
    if (size !== undefined) qsParams.push(`size=${encodeURIComponent(String(size))}`);
    if (sort) qsParams.push(`sort=${encodeURIComponent(sort)}`);
    if (mine === true) qsParams.push("mine=true");
    const qs = qsParams.length ? `?${qsParams.join("&")}` : "";

    const headers: Record<string, string> = {};
    if (mine === true && ownerToken) headers["X-Owner-Token"] = ownerToken;

    const { ok, status, data } = await apiRequest(
      "GET",
      `/api/gallery${qs}`,
      undefined,
      headers
    );

    if (!ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to search gallery (${status}): ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
