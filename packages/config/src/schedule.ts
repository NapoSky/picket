import { CronExpressionParser } from 'cron-parser';

/** Five-field cron, interpreted in the instance zone; inclusive of an exact deadline. */
export function latestCronSchedule(expression: string, now: Date, timeZone: string): Date {
  if (expression.trim().split(/\s+/).length !== 5 || /\?|(?:^|[\s,])H(?:$|[\s/(])/.test(expression))
    throw new Error('A deterministic five-field cron expression is required');
  new Intl.DateTimeFormat('en', { timeZone }).format(now);
  return CronExpressionParser.parse(expression, {
    currentDate: new Date(now.getTime() + 1), tz: timeZone,
  }).prev().toDate();
}
