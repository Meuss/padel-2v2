/**
 * HUD buttons. After a mouse click a button gives the focus back, so Space returns to the serve
 * toss; keyboard users keep their focus.
 */

/** Blur `el` after each mouse click on it (a keyboard "click" has detail 0 and keeps the focus). */
export function blurAfterClick(el: HTMLElement): void {
  el.addEventListener("click", (e) => {
    if (e.detail > 0) el.blur();
  });
}

/** A `type="button"` button with a class, a label and a click handler, that blurs after a mouse click. */
export function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  b.addEventListener("click", onClick);
  blurAfterClick(b);
  return b;
}
