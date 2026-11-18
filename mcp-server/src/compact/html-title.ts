import { defaultTreeAdapter, parse, type DefaultTreeAdapterTypes } from "parse5";

const TITLE_PREFIX_LENGTH = 16_384;
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function htmlChild(parent: DefaultTreeAdapterTypes.ParentNode | undefined, name: string) {
  return parent?.childNodes.find((child): child is DefaultTreeAdapterTypes.Element =>
    defaultTreeAdapter.isElementNode(child) && child.namespaceURI === HTML_NAMESPACE && child.tagName === name);
}

function normalizeTitle(title: string): string {
  return title.replace(/[\t\n\f\r ]+/g, " ").replace(/^ | $/g, "");
}

/** Check the submitted document head without running scripts or changing the source. */
export function matchesHtmlHeadTitle(content: string, expectedTitle: string): boolean {
  const expected = normalizeTitle(expectedTitle);
  if (!expected) return false;
  const prefix = content.slice(0, TITLE_PREFIX_LENGTH);
  const document = parse(prefix.startsWith("\uFEFF") ? prefix.slice(1) : prefix, { sourceCodeLocationInfo: true });
  const head = htmlChild(htmlChild(document, "html"), "head");
  const title = htmlChild(head, "title");
  // An artificial EOF can close an unfinished title at the inspection boundary.
  if (!title?.sourceCodeLocation?.endTag) return false;
  const actual = title.childNodes.filter(defaultTreeAdapter.isTextNode).map(node => node.value).join("");
  return normalizeTitle(actual) === expected;
}
