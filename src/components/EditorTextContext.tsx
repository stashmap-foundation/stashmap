import React, { createContext, useContext, useCallback, useState } from "react";

type EditorTextContextType = {
  text: string;
  setText: (text: string) => void;
};

const EditorTextContext = createContext<EditorTextContextType | null>(null);

export function EditorTextProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [text, setTextState] = useState("");

  const setText = useCallback((newText: string) => {
    setTextState(newText);
  }, []);

  return (
    <EditorTextContext.Provider value={{ text, setText }}>
      {children}
    </EditorTextContext.Provider>
  );
}

export function useEditorText(): EditorTextContextType | null {
  return useContext(EditorTextContext);
}
