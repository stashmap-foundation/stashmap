import React, { createContext, useContext, useRef, useCallback, useState } from "react";

type EditorTextContextType = {
  text: string;
  getText: () => string;
  setText: (text: string) => void;
  registerGetText: (fn: () => string) => void;
};

const EditorTextContext = createContext<EditorTextContextType | null>(null);

export function EditorTextProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [text, setTextState] = useState("");
  const getTextRef = useRef<() => string>(() => "");

  const getText = useCallback(() => {
    return getTextRef.current();
  }, []);

  const setText = useCallback((newText: string) => {
    setTextState(newText);
  }, []);

  const registerGetText = useCallback((fn: () => string) => {
    // eslint-disable-next-line functional/immutable-data
    getTextRef.current = fn;
    setTextState(fn());
  }, []);

  return (
    <EditorTextContext.Provider value={{ text, getText, setText, registerGetText }}>
      {children}
    </EditorTextContext.Provider>
  );
}

export function useEditorText(): EditorTextContextType | null {
  return useContext(EditorTextContext);
}
