import { useNodeItemContext } from "./useNodeItemContext";

type UseUpdateArgumentResult = {
  currentArgument: Argument;
  setArgument: (argument: Argument) => void;
  isVisible: boolean;
};

/**
 * Hook for updating row argument (confirms/contra/none).
 * Used by EvidenceSelector.
 */
export function useUpdateArgument(): UseUpdateArgumentResult {
  const {
    isVisible,
    argument: currentArgument,
    updateMetadata,
  } = useNodeItemContext();

  const setArgument = (argument: Argument): void => {
    updateMetadata({ argument });
  };

  return {
    currentArgument,
    setArgument,
    isVisible,
  };
}
