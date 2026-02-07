import React from "react";
import { Route, Routes } from "react-router-dom";
import Dashboard from "./components/Dashboard";
import { Follow } from "./components/Follow";
import { RelaysWrapper } from "./components/Relays";
import { RequireLogin } from "./AppState";
import { SignUp } from "./SignUp";
import { SignInModal } from "./SignIn";
import { Profile } from "./components/Profile";

export function App(): JSX.Element {
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
