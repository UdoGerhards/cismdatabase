// utils/validatePassword.js
export function validatePassword(password, rules) {
  if (password.length < rules.minLength) return false;
  if (password.length > rules.maxLength) return false;

  if (rules.requireUppercase && !/[A-Z]/.test(password)) return false;
  if (rules.requireLowercase && !/[a-z]/.test(password)) return false;
  if (rules.requireNumber && !/[0-9]/.test(password)) return false;
  if (rules.requireSpecialChar && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) return false;

  return true;
}