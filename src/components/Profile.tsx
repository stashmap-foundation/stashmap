import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { InputGroup, Modal } from "react-bootstrap";
import { nip19 } from "nostr-tools";
import QRCode from "react-qr-code";
import { Button } from "../commons/Ui";
import { useData } from "../DataContext";
import { isUserLoggedIn } from "../NostrAuthContext";
import { SignInModal } from "../SignIn";
import { FormControlWrapper } from "../commons/InputElementUtils";

type Identifier = "none" | "npub" | "nprofile" | "invite";

type UserPublicIdentifierProps = {
  identifierName: string;
  identifier: string;
  copyToClipboard: () => void;
  showCopiedSuccess: boolean;
  toggleQrCode: () => void;
  isQRToggled: boolean;
};

function UserPublicIdentifier({
  identifierName,
  identifier,
  copyToClipboard,
  showCopiedSuccess,
  toggleQrCode,
  isQRToggled,
}: UserPublicIdentifierProps): JSX.Element {
  return (
    <div className="flex-row-start m-2 align-items-center">
      <div className="bold w-25">
        {identifierName === "invite"
          ? "Your Knowstr Invite Link"
          : `Your nostr ${identifierName}:`}
      </div>
      <InputGroup>
        <div style={{ position: "relative", flexGrow: 1, maxWidth: "42rem" }}>
          <FormControlWrapper
            aria-label={identifierName}
            defaultValue={identifier}
            disabled
            className="p-2 btn-borderless background-transparent font-size-medium"
          />
          <div
            style={{
              position: "absolute",
              right: "2px",
              top: "10%",
            }}
          >
            <Button
              className="btn-borderless background-white"
              onClick={copyToClipboard}
            >
              <span aria-hidden="true">
                {showCopiedSuccess ? "✓" : "⎘"}
              </span>
            </Button>
            <Button
              className={`btn btn-borderless ${
                isQRToggled ? "background-dark" : "background-white"
              }`}
              onClick={toggleQrCode}
            >
              <span aria-hidden="true">▣</span>
            </Button>
          </div>
        </div>
      </InputGroup>
    </div>
  );
}

export function Profile(): JSX.Element {
  const navigate = useNavigate();
  const { user } = useData();
  const [copied, setCopied] = useState<Identifier>("none");
  const [qrCodeIdentifier, setQrCodeIdentifier] = useState<Identifier>("none");
  if (!isUserLoggedIn(user)) {
    return <SignInModal />;
  }

  const onHide = (): void => {
    navigate("/");
  };

  const copyToClipboard = (text: string): void => {
    navigator.clipboard.writeText(text);
  };

  const npub = nip19.npubEncode(user.publicKey);
  const nprofile = nip19.nprofileEncode({ pubkey: user.publicKey });
  const inviteLink = `${window.location.origin}/follow?publicKey=${user.publicKey}`;

  const encodeForQR = (identifier: string): string => {
    switch (identifier) {
      case "npub":
        return encodeURIComponent(npub);
      case "nprofile":
        return encodeURIComponent(nprofile);
      case "invite":
        return inviteLink;
      default:
        return "";
    }
  };

  return (
    <Modal show onHide={onHide} size="xl">
      <Modal.Header closeButton>
        <Modal.Title>Your Profile</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="container-fluid">
          <UserPublicIdentifier
            identifierName="npub"
            identifier={npub as string}
            copyToClipboard={() => {
              copyToClipboard(npub);
              if (copied !== "npub") {
                setCopied("npub");
              }
            }}
            showCopiedSuccess={copied === "npub"}
            toggleQrCode={() => {
              if (qrCodeIdentifier === "npub") {
                setQrCodeIdentifier("none");
              } else {
                setQrCodeIdentifier("npub");
              }
            }}
            isQRToggled={qrCodeIdentifier === "npub"}
          />
          <UserPublicIdentifier
            identifierName="nprofile"
            identifier={nprofile as string}
            copyToClipboard={() => {
              copyToClipboard(nprofile);
              if (copied !== "nprofile") {
                setCopied("nprofile");
              }
            }}
            showCopiedSuccess={copied === "nprofile"}
            toggleQrCode={() => {
              if (qrCodeIdentifier === "nprofile") {
                setQrCodeIdentifier("none");
              } else {
                setQrCodeIdentifier("nprofile");
              }
            }}
            isQRToggled={qrCodeIdentifier === "nprofile"}
          />

          <UserPublicIdentifier
            identifierName="invite"
            identifier={inviteLink}
            copyToClipboard={() => {
              copyToClipboard(inviteLink);
              if (copied !== "invite") {
                setCopied("invite");
              }
            }}
            showCopiedSuccess={copied === "invite"}
            toggleQrCode={() => {
              if (qrCodeIdentifier === "invite") {
                setQrCodeIdentifier("none");
              } else {
                setQrCodeIdentifier("invite");
              }
            }}
            isQRToggled={qrCodeIdentifier === "invite"}
          />
          {qrCodeIdentifier !== "none" && (
            <div className="flex-row-center m-2">
              <QRCode value={encodeForQR(qrCodeIdentifier)} level="M" />
            </div>
          )}
        </div>
      </Modal.Body>
    </Modal>
  );
}
