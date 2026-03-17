export function unregister(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.ready.then((registration) => {
    registration.unregister();
  });
}
