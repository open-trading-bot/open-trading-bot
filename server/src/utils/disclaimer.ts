export const DISCLAIMER_VERSION = '2026-04-18';

export const DISCLAIMER_LANGS = ['en', 'he'] as const;
export type DisclaimerLang = typeof DISCLAIMER_LANGS[number];

export const DISCLAIMER: Record<DisclaimerLang, { requiredSignature: string; text: string }> = {
  en: {
    requiredSignature: 'I ACCEPT',
    text: `**Trading Risk & Liability Disclaimer**

By accepting this disclaimer, you acknowledge and agree that:

1. **Your decisions, your responsibility.** All trading, investment, and risk decisions you make using this platform are solely your own. You are fully responsible for every order placed, every strategy activated, and every configuration you apply.

2. **No financial advice.** This platform does not provide financial, investment, tax, or legal advice. Nothing shown in the interface, documentation, or outputs constitutes a recommendation to buy, sell, or hold any asset.

3. **Substantial risk of loss.** Cryptocurrency and derivatives trading is highly volatile and carries a substantial risk of loss. You may lose some or all of your capital. Past performance, backtest results, and simulated outcomes do not guarantee future results.

4. **No warranty on the system.** The platform is provided "as is," without warranty of any kind. It may contain bugs, produce incorrect results, fail to execute orders, experience downtime, or behave unexpectedly. You are responsible for monitoring its behavior and stopping it if something looks wrong.

5. **No claims against the developer or the system.** You agree not to hold the platform, its developers, operators, or contributors liable for any losses, damages, costs, missed opportunities, or consequences of any kind arising from your use of the system — whether caused by the software, the exchange, network outages, third-party services, or any other factor.

6. **Compliance is your responsibility.** You confirm that your use of this platform is legal in your jurisdiction and complies with all applicable laws, including tax obligations.

By typing the confirmation phrase below, you indicate that you have read, understood, and accepted this disclaimer in its entirety.`,
  },
  he: {
    requiredSignature: 'אני מאשר',
    text: `**כתב ויתור על סיכוני מסחר ואחריות**

בקבלת כתב ויתור זה, אתה מאשר ומסכים כי:

1. **ההחלטות שלך, האחריות שלך.** כל החלטות המסחר, ההשקעה וניהול הסיכונים שתבצע באמצעות פלטפורמה זו הן שלך בלבד. אתה אחראי באופן מלא לכל פקודה שתוצב, לכל אסטרטגיה שתופעל ולכל הגדרה שתחיל.

2. **אין ייעוץ פיננסי.** פלטפורמה זו אינה מספקת ייעוץ פיננסי, השקעות, מס או משפטי. שום דבר מהמוצג בממשק, בתיעוד או בתפוקות אינו מהווה המלצה לקנות, למכור או להחזיק נכס כלשהו.

3. **סיכון מהותי להפסד.** המסחר במטבעות קריפטוגרפיים ובנגזרים הוא תנודתי מאוד וטומן בחובו סיכון מהותי להפסד. ייתכן שתאבד חלק או את כל הונך. ביצועי עבר, תוצאות בקטסט ותוצאות מדומות אינם ערובה לתוצאות עתידיות.

4. **אין אחריות על המערכת.** הפלטפורמה מסופקת "כפי שהיא", ללא אחריות מכל סוג. ייתכן שתכיל תקלות, תפיק תוצאות שגויות, תיכשל בביצוע פקודות, תחווה השבתות או תתנהג בצורה לא צפויה. אתה אחראי לעקוב אחר התנהגותה ולעצור אותה אם משהו נראה שגוי.

5. **אין תביעות כנגד המפתח או המערכת.** אתה מסכים לא להחזיק את הפלטפורמה, מפתחיה, מפעיליה או תורמיה באחריות לכל הפסד, נזק, עלות, הזדמנות שהוחמצה או תוצאה מכל סוג שנובעים משימושך במערכת — בין אם נגרמו על ידי התוכנה, הבורסה, הפסקות רשת, שירותי צד שלישי או כל גורם אחר.

6. **ציות הוא באחריותך.** אתה מאשר ששימושך בפלטפורמה זו הוא חוקי בתחום השיפוט שלך ועומד בכל החוקים החלים, כולל חובות מס.

בהקלדת משפט האישור למטה, אתה מציין כי קראת, הבנת וקיבלת כתב ויתור זה במלואו.`,
  },
};

export function isDisclaimerLang(v: unknown): v is DisclaimerLang {
  return typeof v === 'string' && (DISCLAIMER_LANGS as readonly string[]).includes(v);
}

export function normaliseSignature(s: string): string {
  return s.trim().toLowerCase();
}

export function isSignatureValid(lang: DisclaimerLang, signature: unknown): signature is string {
  if (typeof signature !== 'string') return false;
  return normaliseSignature(signature) === normaliseSignature(DISCLAIMER[lang].requiredSignature);
}
