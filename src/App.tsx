import React, { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import Dashboard from "./components/Dashboard";
import { Follow } from "./components/Follow";
import { RelaysWrapper } from "./components/Relays";
import { RequireLogin } from "./AppState";
import { SignUp } from "./SignUp";
import { SignInModal } from "./SignIn";
import { Profile } from "./components/Profile";

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
        <Route path="/" element={<Dashboard />}>
          <Route path="profile" element={<Profile />} />
          <Route path="follow" element={<Follow />} />
          <Route path="relays" element={<RelaysWrapper />} />
          <Route path="signin" element={<SignInModal />} />
          <Route path="signup" element={<SignUp />} />
        </Route>
        <Route path="/n/*" element={<Dashboard />} />
        <Route path="/r/:relationId" element={<Dashboard />} />
      </Route>
    </Routes>
  );
}
