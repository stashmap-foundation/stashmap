import React, { useState } from "react";
import { Alert, Dropdown, Modal } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { NotificationCenter } from "../commons/NotificationCenter";
import { DeleteWorkspace } from "./DeleteNode";
import { useData } from "../DataContext";
import { planPublishSettings, usePlanner } from "../planner";
import { PublishingStatusWrapper } from "./PublishingStatusWrapper";
import { SignInMenuBtn } from "../SignIn";
import { isUserLoggedIn, useLogout } from "../NostrAuthContext";

export function NavbarControls(): JSX.Element {
  const navigate = useNavigate();
  const logout = useLogout();
  const { createPlan, executePlan } = usePlanner();
  const [isError, setIsError] = useState<boolean>(false);
  const { settings, user } = useData();
  const isBionic = settings.bionicReading;

  const onToggleBionic = async (): Promise<void> => {
    try {
      await executePlan(
        planPublishSettings(createPlan(), {
          ...settings,
          bionicReading: !isBionic,
        })
      );
    } catch (e) {
      setIsError(true);
      // eslint-disable-next-line no-console
      console.error(e);
    }
  };
  const isLoggedIn = isUserLoggedIn(user);

  return (
    <>
      <Modal show={isError} onHide={() => setIsError(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Error</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="danger">
            {`Couldn't turn ${
              isBionic ? "off" : "on"
            } Bionic Reading. Please try again later.`}
          </Alert>
        </Modal.Body>
      </Modal>
      <div className="navbar-right d-flex align-items-center gap-2">
        <PublishingStatusWrapper />
        <SignInMenuBtn />
        <NotificationCenter />
        <Dropdown className="options-dropdown">
          <Dropdown.Toggle
            as="button"
            className="btn"
            aria-label="open menu"
            tabIndex={0}
          >
            <span className="simple-icon-options-vertical" />
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <DeleteWorkspace as="item" />
            <Dropdown.Item
              className="d-flex workspace-selection"
              onClick={() => navigate("/profile")}
              aria-label="show profile"
              tabIndex={0}
            >
              <span className="simple-icon-user d-block dropdown-item-icon" />
              <div className="workspace-selection-text">Profile</div>
            </Dropdown.Item>
            <Dropdown.Item
              className="d-flex workspace-selection"
              onClick={() => navigate("/follow")}
              aria-label="follow user"
              tabIndex={0}
            >
              <span className="simple-icon-user-follow d-block dropdown-item-icon" />
              <div className="workspace-selection-text">Follow User</div>
            </Dropdown.Item>
            <Dropdown.Item
              className="d-flex workspace-selection"
              onClick={() => navigate("/relays")}
              aria-label="edit relays"
              tabIndex={0}
            >
              <span className="icon-nostr-logo d-block dropdown-item-icon" />
              <div className="workspace-selection-text">Relays</div>
            </Dropdown.Item>
            <Dropdown.Item
              className="d-flex workspace-selection"
              onClick={onToggleBionic}
              aria-label={`switch bionic reading ${isBionic ? "off" : "on"}`}
              tabIndex={0}
            >
              <span
                className={`simple-icon-eyeglass d-block dropdown-item-icon ${
                  isBionic ? "bold" : ""
                }`}
              />
              <div className="workspace-selection-text">
                Turn {isBionic ? "off" : "on"} Bionic Reading
              </div>
            </Dropdown.Item>
            {isLoggedIn && (
              <Dropdown.Item
                className="d-flex workspace-selection"
                onClick={logout}
                aria-label="logout"
                tabIndex={0}
              >
                <span className="simple-icon-logout d-block dropdown-item-icon" />
                <div className="workspace-selection-text">Log Out</div>
              </Dropdown.Item>
            )}
          </Dropdown.Menu>
        </Dropdown>
      </div>
    </>
  );
}
