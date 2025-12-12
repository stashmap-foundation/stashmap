import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { LongID, ROOT } from "./types";

interface NavigationStackContextType {
  stack: LongID[];
  push: (nodeID: LongID) => void;
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
  const [stack, setStack] = useState<LongID[]>([ROOT]);
  const navigate = useNavigate();
  const location = useLocation();

  // Sync stack with URL changes
  useEffect(() => {
    const match = location.pathname.match(/^\/w\/([^/]+)/);
    if (match) {
      const currentWorkspace = decodeURIComponent(match[1]) as LongID;
      setStack((prevStack) => {
        // If navigating to ROOT, reset stack to just ROOT
        if (currentWorkspace === ROOT) {
          return [ROOT];
        }

        const existingIndex = prevStack.indexOf(currentWorkspace);
        if (existingIndex !== -1) {
          // Pop back to existing workspace
          return prevStack.slice(0, existingIndex + 1);
        } else {
          // Push new workspace - ensure ROOT is always at the base
          const baseStack = prevStack.length === 0 ? [ROOT] : prevStack;
          return [...baseStack, currentWorkspace];
        }
      });
    }
  }, [location.pathname]);

  const push = (nodeID: LongID): void => {
    navigate(`/w/${nodeID}`);
  };

  const pop = (): void => {
    if (stack.length > 1) {
      const previousWorkspace = stack[stack.length - 2];
      navigate(`/w/${previousWorkspace}`);
    }
  };

  const popTo = (index: number): void => {
    if (index >= 0 && index < stack.length) {
      const targetWorkspace = stack[index];
      navigate(`/w/${targetWorkspace}`);
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
