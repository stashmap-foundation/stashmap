import React, { useState } from "react";

type InputElementFocus = {
  isInputElementInFocus: boolean;
  setIsInputElementInFocus: (isInputElementInFocus: boolean) => void;
};

export const FocusContext = React.createContext<InputElementFocus | undefined>(
  undefined
);

export function FocusContextProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [isInputElementInFocus, setIsInputElementInFocus] =
    useState<boolean>(false);
  return (
    <FocusContext.Provider
      value={{
        isInputElementInFocus,
        setIsInputElementInFocus,
      }}
    >
      {children}
    </FocusContext.Provider>
  );
}
