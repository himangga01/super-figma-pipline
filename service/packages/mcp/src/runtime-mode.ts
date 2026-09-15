let daemon = false;
export const enableDaemonMode = () => {
  daemon = true;
};
export const isDaemonMode = () => daemon;
