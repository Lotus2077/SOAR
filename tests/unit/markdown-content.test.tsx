/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { MarkdownContent } from "../../src/renderer/src/App";

describe("MarkdownContent", () => {
  it("renders agent-oriented GFM without executing raw HTML or unsafe links", () => {
    render(
      <MarkdownContent
        text={`## Result

| File | State |
| --- | --- |
| app.ts | changed |

\`\`\`ts
export const ready = true;
\`\`\`

[unsafe](javascript:alert(1))

![remote preview](https://example.com/private.png)

<script>window.compromised = true</script>`}
      />,
    );

    expect(screen.getByRole("heading", { name: "Result" })).toBeVisible();
    expect(screen.getByRole("table")).toHaveTextContent("app.ts");
    expect(screen.getByRole("button", { name: "Copy" })).toBeVisible();
    expect(screen.getByText("[Image: remote preview]")).toBeVisible();
    expect(screen.queryByText("window.compromised = true")).not.toBeInTheDocument();
    const sanitizedLink = screen.getByText("unsafe").closest("a");
    expect(sanitizedLink).not.toBeNull();
    expect(sanitizedLink?.getAttribute("href") || "").not.toContain("javascript:");
  });
});
