import React from "react";
import { Form, Modal } from "react-bootstrap";
import { getPublicKey, nip19 } from "nostr-tools";
// eslint-disable-next-line import/no-unresolved
import * as nip06 from "nostr-tools/nip06";
import { useLocation, useNavigate } from "react-router-dom";
import { hexToBytes } from "@noble/hashes/utils";

type LocationState = {
  referrer?: string;
};

export function SignUp(): JSX.Element {
  document.body.classList.add("background");
  const navigate = useNavigate();
  const location = useLocation();
  const referrer =
    (location.state as LocationState | undefined)?.referrer || "/signin";

  const mnemonic = nip06.generateSeedWords();
  const pk = nip06.privateKeyFromSeedWords(mnemonic);
  const privateKey = hexToBytes(pk);

  const nsec = nip19.nsecEncode(privateKey);

  const publicKey = getPublicKey(privateKey);
  const npub = nip19.npubEncode(publicKey);
  const onHide = (): void => {
    navigate(referrer);
  };

  return (
    <Modal show onHide={onHide}>
      <Modal.Header closeButton>
        <Modal.Title>Secure your Private Key</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="font-size-small">
          Your private key is essential for accessing your Account. If lost, you
          can&apos;t retrieve your Account; if compromised, your privacy is at
          risk. Write it down and store it in a secure place. Avoid digital
          storage to reduce hacking risks and never share it with anyone.
          Keeping your key safe ensures your privacy and access to your Account.
        </div>
        <div className="mt-3">
          <div className="fw-bold">Your Mnemonic (use this to login)</div>
          <div className="font-size-small">
            You can use this to login and as a backup to restore your Private
            Key
          </div>
          <Form.Control
            aria-label="Mnemonic"
            className="mt-2"
            value={mnemonic}
            readOnly
          />
        </div>
        <div className="mt-3">
          <div className="fw-bold">Your Private Key (alternative login)</div>
          <Form.Control
            aria-label="Private Key"
            className="mt-2"
            value={nsec}
            readOnly
          />
        </div>
        <div className="mt-3">
          <div className="fw-bold">Your Public Key</div>
          <Form.Control
            aria-label="Public Key"
            className="mt-2"
            value={npub}
            readOnly
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-outline-dark" onClick={onHide}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-outline-dark"
          onClick={() => navigate(referrer)}
        >
          I created a backup of my key
        </button>
      </Modal.Footer>
    </Modal>
  );
}
