import React, { createContext, useContext, useState, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

interface NavigationStackContextType {
  stack: ID[];
  push: (nodeID: ID) => void;
  pop: () => void;
  popTo: (index: number) => void;
}

const NavigationStackContext = createContext<
  NavigationStackContextType | undefined
>(undefined);

export function NavigationStackProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [stack, setStack] = useState<ID[]>([]);
  const navigate = useNavigate();

  const push = (nodeID: ID): void => {
    setStack((prev) => [...prev, nodeID]);
    navigate(`/w/${nodeID}`);
  };

  const pop = (): void => {
    if (stack.length > 1) {
      const newStack = stack.slice(0, -1);
      setStack(newStack);
      navigate(`/w/${newStack[newStack.length - 1]}`);
    }
  };

  const popTo = (index: number): void => {
    if (index >= 0 && index < stack.length) {
      const newStack = stack.slice(0, index + 1);
      setStack(newStack);
      navigate(`/w/${newStack[newStack.length - 1]}`);
    }
  };

  return (
    <NavigationStackContext.Provider value={{ stack, push, pop, popTo }}>
      {children}
    </NavigationStackContext.Provider>
  );
}

export function useNavigationStack(): NavigationStackContextType {
  const context = useContext(NavigationStackContext);
  if (!context) {
    throw new Error(
      "useNavigationStack must be used within NavigationStackProvider"
    );
  }
  return context;
}
