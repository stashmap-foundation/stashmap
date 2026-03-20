import React from "react";
import { Outlet } from "react-router-dom";
import "./styles/App.css";
import Data from "./Data";
import { useUser } from "./NostrAuthContext";
import { UNAUTHENTICATED_USER_PK } from "../../usecases/core/auth";

export { UNAUTHENTICATED_USER_PK } from "../../usecases/core/auth";

export function RequireLogin(): JSX.Element {
  const user = useUser() || {
    publicKey: UNAUTHENTICATED_USER_PK,
  };
  return (
    <Data user={user}>
      <Outlet />
    </Data>
  );
}
