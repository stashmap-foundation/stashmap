import React from "react";
import { Dropdown } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { Map } from "immutable";
import { Badge } from "./Ui";

/* eslint-disable react/no-array-index-key */
export function NotificationCenter(): JSX.Element | null {
  const navigate = useNavigate();
  // TODO: add notifications for new followers
  const notifications = Map<string, NotificationMessage>();
  if (notifications.size === 0) {
    return null;
  }

  return (
    <Dropdown>
      <Dropdown.Toggle
        as="button"
        id="notification-dropdown"
        key="notification-dropdown"
        className="btn"
        aria-label="notification-center"
        tabIndex={0}
      >
        <Badge ariaLabel="number of notifications" value={notifications.size} />
        <span className="d-block" aria-hidden="true">
          🔔
        </span>
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item
          className="d-flex workspace-selection"
          key="notification-center-item"
        >
          <div className="bold">
            <h3>Notifications</h3>
          </div>
        </Dropdown.Item>
        {notifications
          .map((notification, id) => {
            return (
              <div key={`notification-center-item ${id}`}>
                <Dropdown.Divider />
                <Dropdown.Item
                  className="d-flex workspace-selection"
                  onClick={(): void => {
                    if (notification.navigateToLink) {
                      navigate(`${notification.navigateToLink}`);
                    }
                  }}
                  tabIndex={0}
                >
                  <div>
                    <div className="mt-0 pe-0">
                      <span className="text-extra-small text-muted">
                        {notification.date
                          ? notification.date.toLocaleString()
                          : "Date not found"}
                      </span>
                    </div>
                    <div className="mt-1">
                      <div className="bold">{notification.title}</div>
                      <div className="mt-1">{notification.message}</div>
                    </div>
                  </div>
                </Dropdown.Item>
              </div>
            );
          })
          .valueSeq()}
      </Dropdown.Menu>
    </Dropdown>
  );
}
