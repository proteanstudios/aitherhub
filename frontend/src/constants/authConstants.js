export const AUTH_URLS = {
  LOGIN: '/login',
  REGISTER: '/register',
};

export function isAuthEndpoint(url) {
  if (!url) return false;
  try {
    // Consider full URLs and relative paths
    const u = String(url);
    return u.includes('/auth');
  } catch (e) {
    return false;
  }
}

// Validation error messages
export const VALIDATION_MESSAGES = {
  EMAIL_REQUIRED: "メールアドレスを入力してください",
  EMAIL_INVALID_FORMAT: "メールアドレスの形式が正しくありません",
  PASSWORD_REQUIRED: "パスワードを入力してください",
  CURRENT_PASSWORD_REQUIRED: "現在のパスワードを入力してください",
  NEW_PASSWORD_REQUIRED: "新しいパスワードを入力してください",
  CONFIRM_PASSWORD_REQUIRED: "パスワードを再入力してください",
  NEW_CONFIRM_PASSWORD_REQUIRED: "新しいパスワードを再入力してください",
  PASSWORDS_NOT_MATCH: "パスワードが一致しません",
  PASSWORD_MIN_LENGTH: "パスワードは8文字以上で入力してください",
  CHECKBOX_REQUIRED: "利用規約とプライバシーポリシーに同意してください",
};

// Success messages
export const SUCCESS_MESSAGES = {
  LOGIN_SUCCESS: "ログインに成功しました",
  REGISTER_SUCCESS: "登録に成功しました",
  PASSWORD_CHANGE_SUCCESS: "パスワードの変更に成功しました",
};

// Error messages from server (mapped to Japanese)
export const SERVER_ERROR_MESSAGES = {
  LOGIN_FAILED: "ログインに失敗しました",
  REGISTER_FAILED: "登録に失敗しました",
  PASSWORD_CHANGE_FAILED: "パスワードの変更に失敗しました",
  INVALID_CREDENTIALS: "メールアドレスまたはパスワードが正しくありません",
  USER_NOT_FOUND: "ユーザーが見つかりません",
  UNAUTHORIZED: "認証に失敗しました",
  EMAIL_ALREADY_EXISTS: "このメールアドレスは既に登録されています",
  EMAIL_INVALID_FORMAT: "メールアドレスの形式が正しくありません",
  PASSWORD_TOO_SHORT: "パスワードは8文字以上で入力してください",
  PASSWORD_TOO_WEAK: "パスワードが弱すぎます",
  CURRENT_PASSWORD_INCORRECT: "現在のパスワードが正しくありません",
};

/**
 * Map server error message to Japanese
 * @param {string} detail - Error detail from server
 * @param {string} context - Context: 'login', 'register', or 'changePassword'
 * @returns {string} Japanese error message
 */
export function mapServerErrorToJapanese(detail, context = 'login') {
  if (!detail) {
    return SERVER_ERROR_MESSAGES[`${context.toUpperCase()}_FAILED`] || "エラーが発生しました";
  }

  const lowerDetail = detail.toLowerCase();

  // Common error patterns
  if (lowerDetail.includes("already exists") || lowerDetail.includes("duplicate")) {
    return SERVER_ERROR_MESSAGES.EMAIL_ALREADY_EXISTS;
  }
  
  if (lowerDetail.includes("invalid") && (lowerDetail.includes("email") || lowerDetail.includes("format"))) {
    return SERVER_ERROR_MESSAGES.EMAIL_INVALID_FORMAT;
  }
  
  if (lowerDetail.includes("invalid") || lowerDetail.includes("incorrect")) {
    if (context === 'login') {
      return SERVER_ERROR_MESSAGES.INVALID_CREDENTIALS;
    }
    if (context === 'changePassword') {
      return SERVER_ERROR_MESSAGES.CURRENT_PASSWORD_INCORRECT;
    }
  }
  
  if (lowerDetail.includes("not found") || lowerDetail.includes("user")) {
    return SERVER_ERROR_MESSAGES.USER_NOT_FOUND;
  }
  
  if (lowerDetail.includes("unauthorized")) {
    return SERVER_ERROR_MESSAGES.UNAUTHORIZED;
  }
  
  if (lowerDetail.includes("password") && (lowerDetail.includes("short") || lowerDetail.includes("8"))) {
    return SERVER_ERROR_MESSAGES.PASSWORD_TOO_SHORT;
  }
  
  if (lowerDetail.includes("weak")) {
    return SERVER_ERROR_MESSAGES.PASSWORD_TOO_WEAK;
  }
  
  if (lowerDetail.includes("not match")) {
    return SERVER_ERROR_MESSAGES.PASSWORDS_NOT_MATCH;
  }

  // Return original detail if no mapping found
  return detail;
}
