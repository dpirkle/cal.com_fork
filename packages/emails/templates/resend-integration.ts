/** biome-ignore-all lint/nursery/noTernary: it sucks */
import process from "node:process";
import dayjs from "@calcom/dayjs";
import { markdownToSafeHTML } from "@calcom/lib/markdownToSafeHTML";
import { TimeFormat } from "@calcom/lib/timeFormat";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import Bottleneck from "bottleneck";
import { default as cloneDeep } from "lodash/cloneDeep";
import { marked } from "marked";
import markedPlaintify from "marked-plaintify";
import { type CreateEmailOptions, Resend } from "resend";
import generateIcsFile, { GenerateIcsRole } from "../lib/generateIcsFile";
import type BaseEmail from "./_base-email";
import AttendeeCancelledEmail from "./attendee-cancelled-email";
import AttendeeRescheduledEmail from "./attendee-rescheduled-email";
import AttendeeScheduledEmail from "./attendee-scheduled-email";
import AttendeeWasRequestedToRescheduleEmail from "./attendee-was-requested-to-reschedule-email";
import OrganizerCancelledEmail from "./organizer-attendee-cancelled-seat-email";
import OrganizerRequestedToRescheduleEmail from "./organizer-requested-to-reschedule-email";
import OrganizerRescheduledEmail from "./organizer-rescheduled-email";
import OrganizerScheduledEmail from "./organizer-scheduled-email";
import WorkflowEmail from "./workflow-email";

type EmailWithEvent = BaseEmail & {
  calEvent: CalendarEvent;
  attendee?: Person;
};

type IcalEvent = {
  filename: string;
  content: string;
};

const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 600 });

function scheduleResendRequest(resendOptions: CreateEmailOptions) {
  return limiter.schedule(() => {
    const resend = new Resend(process.env.RESEND_HTTP_API_KEY);
    return resend.emails.send(resendOptions);
  });
}

function getErrorPromise(msg: string) {
  console.error(msg);
  return new Promise((r) => r(msg));
}

enum Role {
  Attendee = "attendee",
  Organizer = "organizer",
}

enum Event {
  Cancelled = "cancelled",
  Rescheduled = "rescheduled",
  RequestReschedule = "request-reschedule",
  Scheduled = "scheduled",
  Reminder = "reminder",
}

function idFrom(email: BaseEmail, to: string, isAttendee: boolean, calEvent: CalendarEvent) {
  const roleAndEvent = getRoleAndEvent(email, isAttendee);
  const primary = to === calEvent.attendees[0]?.email ? "-primary" : "";
  return roleAndEvent ? `${roleAndEvent[0]}-${roleAndEvent[1]}${primary}` : null;
}

function getRoleAndEvent(email: BaseEmail, isAttendee: boolean): [Role, Event] | null {
  if (email instanceof AttendeeCancelledEmail) {
    return [Role.Attendee, Event.Cancelled];
  } else if (email instanceof AttendeeRescheduledEmail) {
    return [Role.Attendee, Event.Rescheduled];
  } else if (email instanceof AttendeeScheduledEmail) {
    return [Role.Attendee, Event.Scheduled];
  } else if (email instanceof AttendeeWasRequestedToRescheduleEmail) {
    return [Role.Attendee, Event.RequestReschedule];
  } else if (email instanceof OrganizerCancelledEmail) {
    return [Role.Organizer, Event.Cancelled];
  } else if (email instanceof OrganizerRescheduledEmail) {
    return [Role.Organizer, Event.Rescheduled];
  } else if (email instanceof OrganizerScheduledEmail) {
    return [Role.Organizer, Event.Scheduled];
  } else if (email instanceof OrganizerRequestedToRescheduleEmail) {
    return [Role.Organizer, Event.RequestReschedule];
  } else if (email instanceof WorkflowEmail) {
    return [isAttendee ? Role.Attendee : Role.Organizer, Event.Reminder];
  } else {
    return null;
  }
}

function whenFrom(startTime: string): string {
  const dateTimeFormat = `ddd, MMM D, YYYY ${TimeFormat.TWELVE_HOUR}`;
  const eventDateAndTime = dayjs(startTime).tz("America/Los_Angeles").locale("en").format(dateTimeFormat);
  return eventDateAndTime;
}

function convertToPlainText(markdownText: string) {
  const mardownNoBrs = markdownText.replaceAll("<br>", "\n");
  const plaintext = marked
    .use(
      markedPlaintify({
        link: (tokens) => `${tokens.text} (at ${tokens.href})`,
      })
    )
    .parse(mardownNoBrs);
  return plaintext;
}

async function icsAttachmentFor(
  calEvent: CalendarEvent,
  isAttendee: boolean,
  isCancelled: boolean
): Promise<IcalEvent> {
  const clonedCalEvent = cloneDeep(calEvent);
  clonedCalEvent.description = await convertToPlainText(calEvent.description || "");
  const icalEvent = generateIcsFile({
    calEvent: clonedCalEvent,
    role: isAttendee ? GenerateIcsRole.ATTENDEE : GenerateIcsRole.ORGANIZER,
    status: isCancelled ? "CANCELLED" : "CONFIRMED",
  });
  return {
    filename: icalEvent?.filename ?? "",
    content: icalEvent?.content ?? "",
  };
}

function whoHtml(calEvent: CalendarEvent) {
  const links = calEvent.attendees.map((person) => personMailToLink(person));
  links.push(personMailToLink(calEvent.organizer));
  const html = links.join("<br/>");
  return html;
}

function personMailToLink(person: Person) {
  return `<a href="mailto:${person.email}">${person.name || person.email}</a>`;
}

export async function sendEmailWithResend(from: string, to: string, email: BaseEmail) {
  const calEvent = (email as EmailWithEvent).calEvent;
  if (calEvent === undefined) {
    return getErrorPromise("internal error, calEvent missing");
  }
  const plainToEmail = to.replace(/.*<(.*)>.*/, "$1");
  const isAttendee = plainToEmail !== calEvent.organizer.email;
  const id = idFrom(email, plainToEmail, isAttendee, calEvent);
  if (id === null) {
    return getErrorPromise("Unknown email, cannot determine template id for resend");
  }
  const icsFile = await icsAttachmentFor(calEvent, isAttendee, id.includes(Event.Cancelled));
  const resendOptions: CreateEmailOptions = {
    from,
    to: to.startsWith(" <") ? plainToEmail : to,
    template: {
      id,
      variables: {
        whoHtml: whoHtml(calEvent),
        what: calEvent.title,
        when: whenFrom(calEvent.startTime),
        where: calEvent.location || "",
        additionalNotes: calEvent.additionalNotes || "None",
        descriptionHtml: markdownToSafeHTML(calEvent.description || null),
        rescheduleLink: `${calEvent.bookerUrl}/reschedule/${calEvent.uid}?rescheduledBy=${plainToEmail}`,
        cancelLink: `${calEvent.bookerUrl}/booking/${calEvent.uid}?cancel=true&allRemainingBookings=false&cancelledBy=${plainToEmail}`,
        reasonForChange: calEvent.cancellationReason?.replace("$RCH$", "") || "",
        rescheduledBy: calEvent.rescheduledBy || "",
      },
    },
    ...(icsFile != null && { attachments: [icsFile] }),
  };
  const { error } = await scheduleResendRequest(resendOptions);
  if (error) {
    return getErrorPromise(
      `Error sending email via resend, name: ${error.name}, status code: ${error.statusCode}, message: ${error.message}`
    );
  }
  return new Promise((r) => r("send email via resend"));
}
