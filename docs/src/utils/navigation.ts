export interface NavItem {
  title: string;
  slug: string;
  children?: NavItem[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navigation: NavSection[] = [
  {
    title: 'Documentation',
    items: [
      { title: 'Getting Started', slug: 'getting-started' },
      { title: 'API Reference', slug: 'api-reference' },
      { title: 'MCP Server', slug: 'mcp-server' },
      { title: 'Examples', slug: 'examples' },
    ],
  },
];
