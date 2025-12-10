import React from "react";
import { Route, Routes } from "react-router-dom";
import Dashboard from "./components/Dashboard";
import { Follow } from "./components/Follow";
import { RelaysWrapper } from "./components/Relays";
import { RequireLogin } from "./AppState";
import { SignUp } from "./SignUp";
import { SignInModal } from "./SignIn";
import { Profile } from "./components/Profile";
import { JoinProject } from "./JoinProjext";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<RequireLogin />}>
        <Route path="/w/:workspaceID" element={<Dashboard />} />
        <Route path="/" element={<Dashboard />}>
          <Route path="/profile" element={<Profile />} />
          <Route path="/follow" element={<Follow />} />
          <Route path="/relays" element={<RelaysWrapper />} />
          <Route path="/signin" element={<SignInModal />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/join/:projectID" element={<JoinProject />} />
        </Route>
      </Route>
    </Routes>
  );
}
