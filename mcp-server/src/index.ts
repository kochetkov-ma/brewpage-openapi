#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.BREWPAGE_URL || "https://brewpage.app";

const server = new McpServer({
  name: "brewpage-mcp",
  version: "1.0.0",
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
    `URL: ${data.url || "N/A"}`,
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

server.tool(
  "publish_html",
  "Publish HTML or Markdown content to BrewPage. Returns a public URL and owner token. Supports password protection and custom TTL.",
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
      .min(30)
      .max(365)
      .optional()
      .describe("Time to live in days (30-365, default: 365)"),
  },
  async ({ content, format, namespace, password, ttlDays }) => {
    const body: Record<string, unknown> = { content, format };
    if (namespace) body.namespace = namespace;
    if (password) body.password = password;
    if (ttlDays) body.ttlDays = ttlDays;

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

    const res = await fetch(`${BASE_URL}/api/files/uploads`, {
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
  "Get BrewPage platform-wide usage statistics including page count, file count, and storage usage.",
  {},
  async () => {
    const { ok, data } = await apiRequest("GET", "/api/stats");

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
  "Publish a multi-file HTML site to BrewPage. Provide HTML content as the entry file (index.html). Returns a public URL and owner token.",
  {
    entryContent: z.string().describe("HTML content for the site entry file (index.html)"),
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
      .describe("Time to live in days (1-30, default: 5)"),
  },
  async ({ entryContent, namespace, password, ttlDays }) => {
    const formData = new FormData();
    const entryBlob = new Blob([entryContent], { type: "text/html" });
    formData.append("files", entryBlob, "index.html");
    formData.append("paths", "index.html");
    if (namespace) formData.append("ns", namespace);
    if (ttlDays) formData.append("ttl", String(ttlDays));

    const headers: Record<string, string> = {};
    if (password) headers["X-Password"] = password;

    const url = `${BASE_URL}/api/sites`;
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
