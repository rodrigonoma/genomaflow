module.exports = {
  NativeBiometric: {
    isAvailable: async () => ({ isAvailable: false }),
    verifyIdentity: async () => {},
  },
};
