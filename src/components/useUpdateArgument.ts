import { useNodeItemContext } from "./useNodeItemContext";

type UseUpdateArgumentResult = {
  currentArgument: Argument;
  setArgument: (argument: Argument) => void;
  isVisible: boolean;
};

/**
 * Hook for updating item argument (confirms/contra/none).
 * Used by EvidenceSelector.
 */
export function useUpdateArgument(): UseUpdateArgumentResult {
  const { isVisible, currentItem, updateMetadata } = useNodeItemContext();

  const currentArgument = currentItem?.argument;

  const setArgument = (argument: Argument): void => {
    updateMetadata({ argument });
  };

  return {
    currentArgument,
    setArgument,
    isVisible,
  };
}
