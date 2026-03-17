import React from "react";
import { Outlet } from "react-router-dom";
import "../../App.css";
import Data from "./Data";
import { useUser } from "./NostrAuthContext";

export const UNAUTHENTICATED_USER_PK = "UNAUTHENTICATEDUSERPK" as PublicKey;

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
