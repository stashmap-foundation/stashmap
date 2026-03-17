import { useChildNodeContext } from "./useChildNodeContext";

type UseUpdateArgumentResult = {
  currentArgument: Argument;
  setArgument: (argument: Argument) => void;
  isVisible: boolean;
};

export function useUpdateArgument(): UseUpdateArgumentResult {
  const { isVisible, currentRow, updateMetadata } = useChildNodeContext();

  const currentArgument = currentRow?.argument;

  const setArgument = (argument: Argument): void => {
    updateMetadata({ argument });
  };

  return {
    currentArgument,
    setArgument,
    isVisible,
  };
}
