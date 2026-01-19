import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MiniEditor } from "./AddNode";

// Mock getImageUrlFromText to avoid async image loading in tests
jest.mock("./AddNode", () => {
  const actual = jest.requireActual("./AddNode");
  return {
    ...actual,
    getImageUrlFromText: jest.fn().mockResolvedValue(undefined),
  };
});

describe("MiniEditor", () => {
  describe("save deduplication", () => {
    test("multiple blur events with same text only call onSave once", async () => {
      const onSave = jest.fn();
      render(
        <MiniEditor
          initialText="Original"
          onSave={onSave}
          autoFocus={false}
        />
      );

      const editor = screen.getByRole("textbox");

      // Change the text
      await userEvent.clear(editor);
      await userEvent.type(editor, "Changed");

      // Trigger blur multiple times (simulating the race condition)
      fireEvent.blur(editor);
      fireEvent.blur(editor);
      fireEvent.blur(editor);

      // Wait for async operations
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1);
      });
      expect(onSave).toHaveBeenCalledWith("Changed", undefined);
    });

    test("blur with unchanged text does not call onSave", async () => {
      const onSave = jest.fn();
      render(
        <MiniEditor
          initialText="Original"
          onSave={onSave}
          autoFocus={false}
        />
      );

      const editor = screen.getByRole("textbox");
      fireEvent.blur(editor);

      // Give time for any async operations
      await waitFor(() => {
        expect(onSave).not.toHaveBeenCalled();
      });
    });

    test("Escape key with changed text calls onSave once", async () => {
      const onSave = jest.fn();
      render(
        <MiniEditor
          initialText="Original"
          onSave={onSave}
          autoFocus={false}
        />
      );

      const editor = screen.getByRole("textbox");
      await userEvent.clear(editor);
      await userEvent.type(editor, "Changed");

      // Press Escape
      fireEvent.keyDown(editor, { key: "Escape" });

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1);
      });
      expect(onSave).toHaveBeenCalledWith("Changed", undefined);
    });

    test("Enter key calls onSave with submitted flag", async () => {
      const onSave = jest.fn();
      render(
        <MiniEditor
          initialText="Original"
          onSave={onSave}
          autoFocus={false}
        />
      );

      const editor = screen.getByRole("textbox");
      await userEvent.clear(editor);
      await userEvent.type(editor, "Changed");

      // Press Enter
      fireEvent.keyDown(editor, { key: "Enter" });

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1);
      });
      expect(onSave).toHaveBeenCalledWith("Changed", undefined, true);
    });

    test("Enter followed by blur does not duplicate save", async () => {
      const onSave = jest.fn();
      render(
        <MiniEditor
          initialText="Original"
          onSave={onSave}
          autoFocus={false}
        />
      );

      const editor = screen.getByRole("textbox");
      await userEvent.clear(editor);
      await userEvent.type(editor, "Changed");

      // Press Enter then blur (simulating focus moving away after Enter)
      fireEvent.keyDown(editor, { key: "Enter" });
      fireEvent.blur(editor);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1);
      });
    });

    test("initialText prop change resets tracking, allowing new save", async () => {
      const onSave = jest.fn();
      const { rerender } = render(
        <MiniEditor
          initialText="First"
          onSave={onSave}
          autoFocus={false}
        />
      );

      const editor = screen.getByRole("textbox");

      // Edit and save
      await userEvent.clear(editor);
      await userEvent.type(editor, "Changed");
      fireEvent.blur(editor);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1);
      });

      // Simulate prop change (e.g., version was created, displayText updated)
      rerender(
        <MiniEditor
          initialText="Changed"
          onSave={onSave}
          autoFocus={false}
        />
      );

      // Now edit again
      await userEvent.clear(editor);
      await userEvent.type(editor, "Changed Again");
      fireEvent.blur(editor);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(2);
      });
      expect(onSave).toHaveBeenLastCalledWith("Changed Again", undefined);
    });

    test("same text typed after prop update does not trigger save", async () => {
      const onSave = jest.fn();
      const { rerender } = render(
        <MiniEditor
          initialText="Original"
          onSave={onSave}
          autoFocus={false}
        />
      );

      // Simulate initialText updated to "Updated" (from external change)
      rerender(
        <MiniEditor
          initialText="Updated"
          onSave={onSave}
          autoFocus={false}
        />
      );

      const editor = screen.getByRole("textbox");
      // Type the same text as initialText
      await userEvent.clear(editor);
      await userEvent.type(editor, "Updated");
      fireEvent.blur(editor);

      // Should not call onSave since text matches initialText
      await waitFor(() => {
        expect(onSave).not.toHaveBeenCalled();
      });
    });
  });
});
