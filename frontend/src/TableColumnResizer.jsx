import { useEffect } from "react";

const MIN_WIDTH = 44;

export default function TableColumnResizer() {
  useEffect(() => {
    const tableKey = table => {
      const headings = [...table.querySelectorAll(":scope > thead > tr:first-child > th")].map(th => th.textContent.trim()).join("|");
      const identity = table.dataset.tableId || [...table.classList].filter(name => name !== "resizable-table").join(".") || headings || "table";
      return `table-columns:${window.location.pathname}:${identity}`;
    };
    const columns = table => [...table.querySelectorAll(":scope > colgroup > col")];
    const setWidth = (table, th, width) => {
      const value = `${Math.max(MIN_WIDTH, Math.round(width))}px`;
      th.style.width = value;
      th.style.minWidth = value;
      const col = columns(table)[th.cellIndex];
      if (col) col.style.width = value;
    };
    const save = table => {
      const widths = [...table.querySelectorAll(":scope > thead > tr:first-child > th")].map(th => Math.round(th.getBoundingClientRect().width));
      try { localStorage.setItem(tableKey(table), JSON.stringify(widths)); } catch { /* Browser storage is optional. */ }
    };
    const enhance = table => {
      if (table.dataset.columnResize === "false" || table.dataset.columnResizeReady) return;
      table.dataset.columnResizeReady = "true";
      table.classList.add("resizable-table");
      [...table.querySelectorAll(":scope > thead > tr:first-child > th")].forEach(th => {
        th.tabIndex = 0;
        th.title = `${th.title ? `${th.title} · ` : ""}Drag the right edge to resize; Alt+Left/Right also resizes`;
      });
      try {
        const saved = JSON.parse(localStorage.getItem(tableKey(table)) || "[]");
        [...table.querySelectorAll(":scope > thead > tr:first-child > th")].forEach((th, index) => {
          if (Number.isFinite(saved[index])) setWidth(table, th, saved[index]);
        });
      } catch { /* Ignore stale per-browser widths. */ }
    };
    const enhanceAll = root => {
      if (root instanceof HTMLTableElement) enhance(root);
      root.querySelectorAll?.("table").forEach(enhance);
    };
    enhanceAll(document);
    const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node instanceof Element) enhanceAll(node);
    })));
    observer.observe(document.body, { childList: true, subtree: true });

    let drag = null;
    const down = event => {
      const th = event.target.closest?.("table.resizable-table thead th");
      if (!th) return;
      const rect = th.getBoundingClientRect();
      if (rect.right - event.clientX > 10) return;
      event.preventDefault();
      drag = { table: th.closest("table"), th, startX: event.clientX, startWidth: rect.width };
      document.body.classList.add("resizing-table-column");
      th.setPointerCapture?.(event.pointerId);
    };
    const move = event => {
      if (drag) setWidth(drag.table, drag.th, drag.startWidth + event.clientX - drag.startX);
    };
    const up = () => {
      if (!drag) return;
      save(drag.table);
      drag = null;
      document.body.classList.remove("resizing-table-column");
    };
    const doubleClick = event => {
      const th = event.target.closest?.("table.resizable-table thead th");
      if (!th || th.getBoundingClientRect().right - event.clientX > 10) return;
      th.style.removeProperty("width"); th.style.removeProperty("min-width");
      const table = th.closest("table");
      const col = columns(table)[th.cellIndex];
      col?.style.removeProperty("width");
      save(table);
    };
    const keyDown = event => {
      if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const th = event.target.closest?.("table.resizable-table thead th");
      if (!th) return;
      event.preventDefault();
      const table = th.closest("table");
      setWidth(table, th, th.getBoundingClientRect().width + (event.key === "ArrowRight" ? 20 : -20));
      save(table);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("dblclick", doubleClick);
    document.addEventListener("keydown", keyDown);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("dblclick", doubleClick);
      document.removeEventListener("keydown", keyDown);
    };
  }, []);
  return null;
}
