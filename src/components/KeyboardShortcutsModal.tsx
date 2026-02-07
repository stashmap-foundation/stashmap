import React from "react";
import { Modal } from "react-bootstrap";

export function KeyboardShortcutsModal({
  show,
  onHide,
}: {
  show: boolean;
  onHide: () => void;
}): JSX.Element {
  return (
    <Modal show={show} onHide={onHide} aria-label="keyboard shortcuts">
      <Modal.Header closeButton>
        <Modal.Title>Keyboard Shortcuts</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <h6>Normal Mode</h6>
        <ul>
          <li>j/k or arrows: move between visible rows</li>
          <li>h/l or arrows: collapse/expand or move parent/child</li>
          <li>g g: first row, G: last row</li>
          <li>Enter or i: edit current row</li>
          <li>/: search in current pane</li>
          <li>
            H: go home (~Log), N: new root note, P: open new pane, q: close pane
          </li>
          <li>[ / ]: switch to previous/next pane</li>
          <li>s: open current row in split pane</li>
          <li>z: open current row in fullscreen</li>
          <li>d d or x: same action as row x button</li>
        </ul>

        <h6>Relevance And Evidence</h6>
        <ul>
          <li>x, ~, ?, !: set current row relevance</li>
          <li>o, +, -: clear/set current row evidence</li>
        </ul>

        <h6>Pane Filters</h6>
        <ul>
          <li>1 relevant, 2 maybe, 3 little, 4 not relevant</li>
          <li>5 contains, 6 confirms, 7 contra, 8 suggestions</li>
          <li>f! f? f~ fx fo f+ f- f@: toggle filters by symbol</li>
        </ul>

        <h6>Help</h6>
        <ul>
          <li>K, F1, or Cmd/Ctrl+/: open this shortcut modal</li>
          <li>Escape: close this modal</li>
        </ul>

        <h6>Insert Mode</h6>
        <ul>
          <li>Enter: save and create next editor (empty editor: outdent)</li>
          <li>Escape: save/close editor and return to normal mode</li>
          <li>Tab: indent at cursor start, Shift+Tab: outdent</li>
        </ul>
      </Modal.Body>
    </Modal>
  );
}
