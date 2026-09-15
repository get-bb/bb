declare module "html-to-docx" {
  interface HtmlToDocxTableRowOptions {
    cantSplit?: boolean;
  }

  interface HtmlToDocxTableOptions {
    row?: HtmlToDocxTableRowOptions;
  }

  interface HtmlToDocxPageSize {
    width?: number;
    height?: number;
  }

  interface HtmlToDocxOptions {
    orientation?: "portrait" | "landscape";
    pageSize?: HtmlToDocxPageSize;
    font?: string;
    fontSize?: number;
    complexScriptFontSize?: number;
    table?: HtmlToDocxTableOptions;
  }

  function HTMLtoDOCX(
    html: string,
    headerHTML?: string | null,
    options?: HtmlToDocxOptions,
    footerHTML?: string | null,
  ): Promise<Buffer>;

  export default HTMLtoDOCX;
}
