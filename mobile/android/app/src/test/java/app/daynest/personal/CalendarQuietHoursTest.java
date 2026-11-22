package app.daynest.personal;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Calendar;
import org.junit.Test;

public class CalendarQuietHoursTest {
    @Test public void crossesMidnightWithAnExclusiveEnd() {
        var quiet = new CalendarReminderReceiver.QuietHours(true, 22 * 60, 8 * 60);
        assertFalse(quiet.contains(localTime(21, 59)));
        assertTrue(quiet.contains(localTime(22, 0)));
        assertTrue(quiet.contains(localTime(0, 0)));
        assertTrue(quiet.contains(localTime(7, 59)));
        assertFalse(quiet.contains(localTime(8, 0)));
    }

    @Test public void supportsDaytimeWindowsAndDisabledSettings() {
        var quiet = new CalendarReminderReceiver.QuietHours(true, 12 * 60, 13 * 60 + 15);
        assertFalse(quiet.contains(localTime(11, 59)));
        assertTrue(quiet.contains(localTime(12, 0)));
        assertTrue(quiet.contains(localTime(13, 14)));
        assertFalse(quiet.contains(localTime(13, 15)));
        assertFalse(new CalendarReminderReceiver.QuietHours(false, 0, 60).contains(localTime(0, 0)));
    }

    private long localTime(int hour, int minute) {
        Calendar date = Calendar.getInstance();
        date.clear();
        date.set(2026, Calendar.NOVEMBER, 22, hour, minute);
        return date.getTimeInMillis();
    }
}
