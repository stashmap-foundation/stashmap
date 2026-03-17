import React, { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
import { RelaysWrapper } from "./Relays";
import { RequireLogin } from "./RequireLogin";
import { SignInModal } from "./SignIn";
import { SignUp } from "./SignUp";

export function App(): JSX.Element {
  useEffect(() => {
    const root = document.body;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.key === "Shift" ||
        event.key === "Control" ||
        event.key === "Alt" ||
        event.key === "Meta" ||
        event.key === "CapsLock"
      ) {
        return;
      }
      root.classList.add("keyboard-input-mode");
    };

    const onMouseMove = (): void => {
      root.classList.remove("keyboard-input-mode");
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousemove", onMouseMove, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousemove", onMouseMove, true);
      root.classList.remove("keyboard-input-mode");
    };
  }, []);

  return (
    <Routes>
      <Route element={<RequireLogin />}>
        <Route path="/" element={<AppShell />}>
          <Route path="follow" element={<Navigate replace to="/" />} />
          <Route path="relays" element={<RelaysWrapper />} />
          <Route path="signin" element={<SignInModal />} />
          <Route path="signup" element={<SignUp />} />
        </Route>
        <Route path="/n/*" element={<AppShell />} />
        <Route path="/r/:nodeId" element={<AppShell />} />
      </Route>
    </Routes>
  );
}
