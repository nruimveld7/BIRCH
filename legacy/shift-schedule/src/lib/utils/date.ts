export const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

export const dowShort = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export type MonthDay = {
  day: number;
  dow: number;
  isWeekend: boolean;
  isToday: boolean;
};

export function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function dowForDay(year: number, monthIndex: number, day1: number) {
  return new Date(year, monthIndex, day1).getDay();
}

export function isWeekend(dow: number) {
  return dow === 0 || dow === 6;
}

export function buildMonthDays(
  year: number,
  monthIndex: number,
  referenceDate: Date | null = null
): MonthDay[] {
  const dim = daysInMonth(year, monthIndex);
  const hasReference = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime());

  return Array.from({ length: dim }, (_, i) => {
    const day = i + 1;
    const dow = dowForDay(year, monthIndex, day);
    const isSameDate =
      hasReference &&
      referenceDate.getFullYear() === year &&
      referenceDate.getMonth() === monthIndex &&
      referenceDate.getDate() === day;

    return {
      day,
      dow,
      isWeekend: isWeekend(dow),
      isToday: Boolean(isSameDate)
    };
  });
}
