/* ===== שאלון לקראת ייעוץ שינה היקשרותי =====
   סכמה משותפת לטופס הציבורי (form.html) ול-CRM (index.html).
   כל שאלה: key יציב, סוג, טקסט, ואפשרויות.
   types: text | textarea | radio | checkbox | grid
*/
window.FORM_TITLE = 'שאלון לקראת ייעוץ שינה היקשרותי';
window.FORM_INTRO =
  'הורים יקרים, תודה שבחרתם לפנות אליי. מטרת השאלון היא לעזור לי להכיר טוב יותר ' +
  'את ילדכם, המשפחה וההרגלים סביב השינה, כדי לבנות עבורכם תהליך מותאם אישית ומדויק.\n' +
  'אין תשובות נכונות או לא נכונות – חשוב לי לקבל תמונה אמיתית של מה שקורה אצלכם בבית, ' +
  'גם מה שעובד וגם מה שמאתגר כרגע.\n\nתודה על הזמן, השיתוף והאמון ❤️';

window.SLEEP_SCHEMA = [
  { section: 'פרטים כלליים', icon: '🗂️', fields: [
    { key: 'parents',   type: 'text',     label: 'שמות ההורים וטלפונים', required: true },
    { key: 'child',     type: 'text',     label: 'שם הילד, מין, תאריך לידה וגיל (במידה ונולד פג יש לציין בנוסף גיל מתוקן)' },
    { key: 'siblings',  type: 'text',     label: 'שמות האחים, גילאים מיקום במשפחה' },
    { key: 'caregiver', type: 'text',     label: 'האם יש דמות מטפלת משמעותית נוספת – מטפלת / סבא / סבתא / דודה / אחר?' },
  ]},
  { section: 'הריון, לידה ותחילת החיים', icon: '🤰', fields: [
    { key: 'pregnancy',    type: 'text',  label: 'תארו את מהלך ההריון, האם היה תקין? האם היה איזשהו מתח / קושי רפואי?' },
    { key: 'birth_week',   type: 'text',  label: 'שבוע לידה' },
    { key: 'birth_weight', type: 'text',  label: 'משקל לידה' },
    { key: 'birth_type',   type: 'radio', label: 'סוג הלידה', options: ['רגילה', 'מכשירנית', 'ניתוח קיסרי'] },
  ]},
  { section: 'בריאות ורקע רפואי', icon: '🩺', fields: [
    { key: 'symptoms', type: 'checkbox', label: 'סמנו האם הילד סובל / סבל בעבר מהתסמינים הבאים:', options: [
      'נזלת כרונית',
      'נשימה מהפה / נחירות / הפסקות נשימה חשודות / שיעול לילי',
      'נוזלים באוזניים / דלקות אוזניים חוזרות',
      'תסמינים במערכת העיכול - ריפלוקס / כאבי בטן / עצירות / שלשולים / תולעי מעיים',
      'בעיות עור / אקזמה / גירודים',
      'אנמיה / חוסר בברזל',
      'תנועתיות מרובה בשינה / חריקת שיניים / הליכה או דיבור מתוך שינה / הזעה מרובה בלילה',
      'אף אחד מהנ"ל',
    ], flags: [0,1,2,3,4,5,6] },
    { key: 'meds',             type: 'textarea', label: 'האם הילד נוטל תרופות קבועות? אם כן – פרטו' },
    { key: 'hospital',         type: 'textarea', label: 'האם הילד עבר אשפוז / ניתוח / תהליך רפואי? אם כן – פרטו' },
    { key: 'medical_followup', type: 'textarea', label: 'האם קיים מעקב רפואי פעיל? אם כן – פרטו' },
  ]},
  { section: 'גדילה, התפתחות, אירועים ושינויים', icon: '📈', fields: [
    { key: 'weight_gain',   type: 'text',     label: 'איך העלייה של הילד במשקל מהלידה ועד היום?' },
    { key: 'dev_difficulty',type: 'textarea', label: 'האם היה בעבר או קיים כיום קושי התפתחותי? אם כן – כיצד טופל ומתי? מול איזה איש מקצוע?' },
    { key: 'milestones',    type: 'checkbox', label: 'סמנו אבני דרך התפתחותיות שהושגו:', options: [
      'התהפכות מהבטן לגב', 'התהפכות מהגב לבטן', 'זחילה', 'ישיבה', 'עמידה', 'הליכה', 'צמיחת שיניים',
    ]},
    { key: 'recent_events', type: 'text',     label: 'האם היו אירועים ושינויים משמעותיים עבור הילד לאחרונה? (חזרת האם לעבודה / מעבר דירה / כניסה למסגרת / לידת אח / פרידה מחיתולים / פרידה מהנקה או בקבוקים) – אם כן, פרטו' },
  ]},
  { section: 'תזונה', icon: '🍽️', fields: [
    { key: 'feeding_type',   type: 'text',     label: 'מהו סוג ההזנה העיקרי מהלידה ועד היום? פרטו (הנקה, בקבוקים, מוצקים, שילוב)' },
    { key: 'eating_day',     type: 'textarea', label: 'איך נראה יום אכילה טיפוסי? פרטו' },
    { key: 'meals_count',    type: 'textarea', label: 'כמה ארוחות הילד אוכל ביום? פרטו' },
    { key: 'pre_sleep_food', type: 'textarea', label: 'מה הילד אוכל לפני השינה? פרטו' },
  ]},
  { section: 'טמפרמנט ורגישות חושית', icon: '🧸', fields: [
    { key: 'temperament_grid', type: 'grid', label: 'דרגו את המאפיינים הבאים מ-1 עד 5 (1 הכי נמוך, 5 הכי גבוה)',
      scale: [1,2,3,4,5], rows: [
        { key: 'motor',     label: 'רמת פעילות מוטורית' },
        { key: 'noise',     label: 'רגישות לרעש' },
        { key: 'light',     label: 'רגישות לאור' },
        { key: 'touch',     label: 'רגישות למגע / בדים' },
        { key: 'adapt',     label: 'הסתגלות לשינוי' },
        { key: 'reaction',  label: 'עוצמת תגובה (1=קל, 5=קשה)' },
        { key: 'persist',   label: 'התמדה / עקשנות' },
        { key: 'closeness', label: 'צורך בקרבה' },
        { key: 'calming',   label: 'קלות הרגעה (1=קל, 5=קשה)' },
      ]},
    { key: 'reacts_noise',     type: 'text',     label: 'איך מגיב לרעשים פתאומיים?' },
    { key: 'calming_time',     type: 'text',     label: 'כמה זמן לוקח לו להירגע? איך נרגע?' },
    { key: 'transitions',      type: 'text',     label: 'איך מגיב למעברים?' },
    { key: 'overwhelm',        type: 'text',     label: "מה מציף אותו? (גורם לו להיכנס לסטרס, בכי וכד')" },
    { key: 'temperament_desc', type: 'textarea', label: 'תארו את הטמפרמנט שלו במילים שלכם' },
  ]},
  { section: 'סדר יום ושגרת השינה', icon: '🌙', fields: [
    { key: 'daily_routine',   type: 'text',     label: 'פרטו על סדר היום שלכם – מתי היקיצה, איזה פעילויות, מתי ארוחות ואיזה, מתי ישן ולכמה זמן?' },
    { key: 'daily_activity',  type: 'textarea', label: 'איזה פעילות הילד עושה לאורך היממה מהקימה, הליכה למסגרת ואח"כ בבית – פרטו' },
    { key: 'naps',            type: 'text',     label: 'כמה תנומות הילד ישן במהלך היום? באיזה שעות ומה אורך כל תנומה?' },
    { key: 'day_sleep_where', type: 'text',     label: 'היכן הילד ישן במהלך היום? איך נרדם?' },
    { key: 'evening_routine', type: 'textarea', label: 'פרטו על שגרת הערב שלכם – זמן מקלחת, ארוחת ערב, "טקס שינה" אם קיים' },
    { key: 'bedtime',         type: 'text',     label: 'באיזה שעה הילד נכנס למיטה?' },
    { key: 'night_sleep_where',type:'text',     label: 'היכן הילד ישן בלילה? איך נרדם?' },
    { key: 'fall_asleep_time',type: 'text',     label: 'כמה זמן לוקח לילד להירדם? כיצד מתנהג בזמן ההירדמות?' },
    { key: 'night_wakings',   type: 'text',     label: 'כמה יקיצות יש במהלך הלילה? באיזה שעות? מי ניגש אליו וכיצד חוזר לישון?' },
    { key: 'avg_sleep',       type: 'text',     label: 'כמה שעות אתם חושבים שהילד שלכם ישן בממוצע ביממה?' },
    { key: 'sleep_env',       type: 'text',     label: 'פרטו על סביבת השינה של הילד – תאורה? טמפרטורה ממוצעת בלילה? רעש לבן / כלי עזר? שמיכה / שק שינה? חפץ מעבר? וכל פרט אחר' },
  ]},
  { section: 'התרשמות ההורים', icon: '💬', fields: [
    { key: 'sleep_desc',       type: 'textarea', label: 'איך הייתם מתארים את השינה של הילד? (רגועה / שקטה / פעילה, הרבה התעוררויות, קושי בחזרה לשינה, חלונות עירות בלילה וכד\')' },
    { key: 'why_now',          type: 'text',     label: 'מדוע פניתם אליי עכשיו? מה הקושי המרכזי עבורכם?' },
    { key: 'how_long',         type: 'text',     label: 'ממתי אתם חווים את הקושי הזה? מה ניסיתם עד היום?' },
    { key: 'want_change',      type: 'text',     label: 'מה אתם רוצים לשנות?' },
    { key: 'keep_working',     type: 'text',     label: 'מה הייתם רוצים שלא נשנה כי עובד לכם טוב?' },
    { key: 'child_strengths',  type: 'text',     label: 'מה החוזקות של הילד שלכם?' },
    { key: 'parent_strengths', type: 'text',     label: 'מה החוזקות שלכם כהורים?' },
    { key: 'additional',       type: 'text',     label: 'דברים נוספים שחשוב לכם שאדע עליכם / על הילד?' },
  ]},
];
