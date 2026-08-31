import React, { useState } from "react";
import { createRoot } from "react-dom/client";

function report(type, detail = {}) {
  return fetch("/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, ...detail }),
  });
}

function App() {
  const [controlled, setControlled] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [presses, setPresses] = useState(0);
  const [formSubmits, setFormSubmits] = useState(0);
  const [role, setRole] = useState("Viewer");
  const [spaReady, setSpaReady] = useState(false);

  return React.createElement(
    "main",
    null,
    React.createElement("h1", null, "Native automation fixture"),
    React.createElement("label", null, "Controlled name", React.createElement("input", {
      "aria-label": "Controlled name",
      value: controlled,
      onChange(event) {
        setControlled(event.target.value);
        report("controlled", { value: event.target.value });
      },
    })),
    React.createElement("div", {
      "aria-label": "Rich editor",
      contentEditable: true,
      role: "textbox",
      suppressContentEditableWarning: true,
      onInput(event) {
        report("rich", { value: event.currentTarget.innerText });
      },
    }),
    React.createElement("label", null, "Role", React.createElement("select", {
      "aria-label": "Role",
      value: role,
      onInput(event) {
        report("select-input", {
          compromised: globalThis.compromised === true,
          label: event.target.selectedOptions[0]?.textContent ?? "",
          value: event.target.value,
        });
      },
      onChange(event) {
        setRole(event.target.value);
        report("select-change", {
          compromised: globalThis.compromised === true,
          label: event.target.selectedOptions[0]?.textContent ?? "",
          value: event.target.value,
        });
      },
    },
    React.createElement("option", { value: "Viewer" }, "Read only"),
    React.createElement("option", { value: "Billing" }, "Administrator"),
    React.createElement("option", { value: "Disabled", disabled: true }, "Disabled option"),
    React.createElement("option", { value: "Admin" }, "Administrator"),
    React.createElement("option", { value: "dup" }, "Duplicate one"),
    React.createElement("option", { value: "dup" }, "Duplicate two"),
    React.createElement("option", { value: "x\"); globalThis.compromised = true; (\"" }, "Injection-shaped value"),
    React.createElement("option", { value: "Owner" }, "Workspace owner"))),
    React.createElement("output", null, `Selected role: ${role}`),
    React.createElement("label", null, "Disabled role", React.createElement("select", { "aria-label": "Disabled role", disabled: true }, React.createElement("option", { value: "Admin" }, "Administrator"))),
    React.createElement("label", null, "Multiple roles", React.createElement("select", { "aria-label": "Multiple roles", multiple: true }, React.createElement("option", { value: "Admin" }, "Administrator"))),
    React.createElement("label", null, "List roles", React.createElement("select", { "aria-label": "List roles", size: 2 }, React.createElement("option", { value: "Admin" }, "Administrator"))),
    React.createElement("button", { "aria-label": "Not a select" }, "Not a select"),
    React.createElement("input", {
      "aria-label": "Keyboard target",
      onKeyDown(event) {
        if (event.key !== "Enter") return;
        const next = presses + 1;
        setPresses(next);
        report("press", { count: next, key: event.key });
      },
    }),
    React.createElement("output", null, `Enter presses: ${presses}`),
    React.createElement("form", {
      onSubmit(event) {
        event.preventDefault();
        const next = formSubmits + 1;
        setFormSubmits(next);
        report("form-submit", { count: next });
      },
    },
    React.createElement("input", { "aria-label": "Form search" }),
    React.createElement("button", { type: "submit" }, "Search"),
    React.createElement("output", null, `Form submits: ${formSubmits}`)),
    React.createElement("button", {
      onClick() {
        setTimeout(() => {
          history.pushState({}, "", "/fixture#spa-ready");
          setSpaReady(true);
        }, 200);
      },
    }, "SPA after 200ms"),
    spaReady ? React.createElement("output", null, "SPA route ready") : null,
    React.createElement("button", {
      onClick() {
        setTimeout(() => {
          location.href = "/document?from=action";
        }, 200);
      },
    }, "Document after 200ms"),
    React.createElement("button", {
      "aria-label": "Nested action",
      onClick() {
        report("nested-click");
      },
    }, React.createElement("span", null, "Nested action content")),
    React.createElement("div", {
      style: { position: "relative", width: 220 },
    },
    React.createElement("button", {
      "aria-label": "Occluded action",
      onClick() {
        report("occluded-click");
      },
    }, "Occluded action"),
    React.createElement("div", {
      "aria-hidden": true,
      style: { background: "rgba(0,0,0,0.2)", inset: 0, position: "absolute", zIndex: 2 },
    })),
    React.createElement("div", { className: "spacer" }),
    React.createElement("button", {
      className: "clipped",
      onPointerDown(event) {
        report("pointer", {
          clientX: event.clientX,
          clientY: event.clientY,
          pointerType: event.pointerType,
          viewportHeight: innerHeight,
          viewportWidth: innerWidth,
        });
      },
      onClick() {
        setMenuOpen(true);
        report("menu-open");
      },
    }, "Clipped menu trigger"),
    menuOpen ? React.createElement("div", { role: "menu" }, "Viewport menu opened") : null,
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
