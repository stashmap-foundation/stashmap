import React, { createContext, useContext, useCallback, useState } from "react";

type EditorTextContextType = {
  spans: InlineSpan[];
  setSpans: (spans: InlineSpan[]) => void;
};

const EditorTextContext = createContext<EditorTextContextType | null>(null);

export function EditorTextProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [spans, setSpansState] = useState<InlineSpan[]>([]);
  const setSpans = useCallback((nextSpans: InlineSpan[]) => {
    setSpansState(nextSpans);
  }, []);

  return (
    <EditorTextContext.Provider value={{ spans, setSpans }}>
      {children}
    </EditorTextContext.Provider>
  );
}

export function useEditorText(): EditorTextContextType | null {
  return useContext(EditorTextContext);
}
