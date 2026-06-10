// Strip the iOS Push Notifications entitlement.
//
// expo-notifications is in Expo's versionedExpoSDKPackages list, so its config
// plugin is auto-applied on every prebuild and unconditionally adds the
// `aps-environment` (APNS / Push Notifications) entitlement. A personal/free
// Apple Developer team cannot sign that capability, so device builds fail with:
//   "Personal development teams … do not support the Push Notifications capability"
//
// This app only uses LOCAL notifications (daily check-in reminder), which need
// no entitlement at all. This plugin runs as a user plugin (after the auto-
// applied ones) and deletes the key so a personal team can sign the build.
//
// If this app ever adds real push (remote) notifications, remove this plugin
// and build with a paid Apple Developer account.

const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutPushNotifications(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults["aps-environment"];
    return cfg;
  });
};
