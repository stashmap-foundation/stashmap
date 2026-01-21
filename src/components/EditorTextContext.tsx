import React, { createContext, useContext, useRef, useCallback } from "react";

type EditorTextContextType = {
  getText: () => string;
  registerGetText: (fn: () => string) => void;
};

const EditorTextContext = createContext<EditorTextContextType | null>(null);

export function EditorTextProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const getTextRef = useRef<() => string>(() => "");

  const getText = useCallback(() => {
    return getTextRef.current();
  }, []);

  const registerGetText = useCallback((fn: () => string) => {
    // eslint-disable-next-line functional/immutable-data
    getTextRef.current = fn;
  }, []);

  return (
    <EditorTextContext.Provider value={{ getText, registerGetText }}>
      {children}
    </EditorTextContext.Provider>
  );
}

export function useEditorText(): EditorTextContextType | null {
  return useContext(EditorTextContext);
}
