import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MiniEditor } from "./AddNode";

const plain = (text: string): InlineSpan[] =>
  text === "" ? [] : [{ kind: "text", text }];

function selectContents(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("MiniEditor", () => {
  test("multiple blur events with the same spans save once", async () => {
    const onSave = jest.fn();
    render(
      <MiniEditor
        initialSpans={plain("Original")}
        onSave={onSave}
        autoFocus={false}
      />
    );
    const editor = screen.getByRole("textbox");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Changed");
    fireEvent.blur(editor, { relatedTarget: document.body });
    fireEvent.blur(editor, { relatedTarget: document.body });
    fireEvent.blur(editor, { relatedTarget: document.body });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(plain("Changed"));
  });

  test("unchanged blur does not save", async () => {
    const onSave = jest.fn();
    render(
      <MiniEditor
        initialSpans={plain("Original")}
        onSave={onSave}
        autoFocus={false}
      />
    );
    fireEvent.blur(screen.getByRole("textbox"), {
      relatedTarget: document.body,
    });
    await waitFor(() => expect(onSave).not.toHaveBeenCalled());
  });

  test("Escape saves changed spans once", async () => {
    const onSave = jest.fn();
    render(
      <MiniEditor
        initialSpans={plain("Original")}
        onSave={onSave}
        autoFocus={false}
      />
    );
    const editor = screen.getByRole("textbox");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Changed");
    await userEvent.keyboard("{Escape}");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(plain("Changed"));
  });

  test("Enter saves changed spans as submitted", async () => {
    const onSave = jest.fn();
    render(
      <MiniEditor
        initialSpans={plain("Original")}
        onSave={onSave}
        autoFocus={false}
      />
    );
    const editor = screen.getByRole("textbox");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Changed");
    await userEvent.keyboard("{Enter}");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(plain("Changed"), true);
  });

  test("Enter followed by blur does not duplicate save", async () => {
    const onSave = jest.fn();
    render(
      <MiniEditor
        initialSpans={plain("Original")}
        onSave={onSave}
        autoFocus={false}
      />
    );
    const editor = screen.getByRole("textbox");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Changed");
    await userEvent.keyboard("{Enter}");
    fireEvent.blur(editor, { relatedTarget: document.body });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  test("Enter on an empty editor requests outdent", async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    const onShiftTab = jest.fn();
    render(
      <MiniEditor
        initialSpans={[]}
        onSave={onSave}
        onClose={onClose}
        onShiftTab={onShiftTab}
        autoFocus={false}
      />
    );
    const editor = screen.getByRole("textbox");
    await userEvent.click(editor);
    await userEvent.keyboard("{Enter}");
    expect(onShiftTab).toHaveBeenCalledWith([]);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("new initial spans reset save tracking", async () => {
    const onSave = jest.fn();
    const { rerender } = render(
      <MiniEditor
        initialSpans={plain("First")}
        onSave={onSave}
        autoFocus={false}
      />
    );
    const editor = screen.getByRole("textbox");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Changed");
    fireEvent.blur(editor, { relatedTarget: document.body });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    rerender(
      <MiniEditor
        initialSpans={plain("Changed")}
        onSave={onSave}
        autoFocus={false}
      />
    );
    await userEvent.clear(editor);
    await userEvent.type(editor, "Changed Again");
    fireEvent.blur(editor, { relatedTarget: document.body });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith(plain("Changed Again"));
  });

  test("matching new initial spans do not save", async () => {
    const onSave = jest.fn();
    const { rerender } = render(
      <MiniEditor
        initialSpans={plain("Original")}
        onSave={onSave}
        autoFocus={false}
      />
    );
    rerender(
      <MiniEditor
        initialSpans={plain("Updated")}
        onSave={onSave}
        autoFocus={false}
      />
    );
    const editor = screen.getByRole("textbox");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Updated");
    fireEvent.blur(editor, { relatedTarget: document.body });
    await waitFor(() => expect(onSave).not.toHaveBeenCalled());
  });

  test("edits link labels without losing targets", async () => {
    const onSave = jest.fn();
    render(
      <MiniEditor
        initialSpans={[
          { kind: "text", text: "See " },
          { kind: "link", href: "#target", text: "old" },
          { kind: "text", text: " now" },
        ]}
        onSave={onSave}
        autoFocus={false}
      />
    );
    const editor = screen.getByRole("textbox");
    const mark = screen.getByRole("link");
    await userEvent.click(editor);
    selectContents(mark);
    await userEvent.keyboard("new");
    fireEvent.blur(editor, {
      relatedTarget: document.body,
    });
    expect(onSave).toHaveBeenCalledWith([
      { kind: "text", text: "See " },
      { kind: "link", href: "#target", text: "new" },
      { kind: "text", text: " now" },
    ]);
  });
});
