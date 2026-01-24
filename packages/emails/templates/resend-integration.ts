import { CalendarEvent, Person } from "@calcom/types/Calendar";
import BaseEmail from "./_base-email";
import { CreateEmailOptions, Resend } from "resend";
import { TimeFormat } from "@calcom/lib/timeFormat";
import dayjs from "@calcom/dayjs";
import { markdownToSafeHTML } from "@calcom/lib/markdownToSafeHTML";
import { default as cloneDeep } from "lodash/cloneDeep";
import generateIcsFile, { GenerateIcsRole } from "../lib/generateIcsFile";
import Bottleneck from 'bottleneck';
import markedPlaintify from 'marked-plaintify'

import { marked } from "marked";


type EmailWithEvent = BaseEmail & {
  calEvent: CalendarEvent
  attendee?: Person;
}


type IcalEvent = {
  filename: string
  content: string
}

const limiter = new Bottleneck({maxConcurrent: 1, minTime: 600,});

function scheduleResendRequest(resendOptions: CreateEmailOptions) {
  return limiter.schedule(() => {
    const resend = new Resend(process.env.RESEND_HTTP_API_KEY);
    return resend.emails.send(resendOptions);
  });
}

export async function sendEmailWithResend(from: string, to: string, email: BaseEmail) {
  const calEvent = (email as EmailWithEvent).calEvent;
  if (calEvent === undefined) {
    return new Promise((r) => r("internal error, calEvent missing"));
  }
  const plainToEmail = to.replace(/.*<(.*)>.*/, '$1');
  const isAttendee = plainToEmail !== calEvent.organizer.email;
  const icsFile = await icsAttachmentFor(calEvent, isAttendee, email.constructor.name.includes("Cancelled"));
  const resendOptions: CreateEmailOptions = {
    from,
    to: to.startsWith(" <") ? plainToEmail : to,
    template: {
      id: idFrom(email, plainToEmail, isAttendee, calEvent),
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
    console.error(`Error sending email via resend, name: ${error.name}, status code: ${error.statusCode}, message: ${error.message}`);
  }
  return new Promise((r) => r("send email via resend"));
}

function idFrom(email: BaseEmail, to: string, isAttendee: boolean, calEvent: CalendarEvent) {
  const primary = (to === calEvent.attendees[0]?.email) ? "-primary" : "";
  if (email.constructor.name ===  "WorkflowEmail") {
    const role = isAttendee ? "attendee" : "organizer";
    return `${role}-reminder${primary}`;
  } else {
    const baseId = email.constructor.name.split(/(?=[A-Z])/).slice(0, -1).join("-").toLowerCase();
    console.error(`email constructor name is: ${email.constructor.name}`);
    console.error(`parts: ${email.constructor.name.split(/(?=[A-Z])/)}`);
    console.error(`baseId is: ${baseId}`);
    return `${baseId}${primary}`;
  }
}


function whenFrom(startTime: string): string {
  const dateTimeFormat = `ddd, MMM D, YYYY ${TimeFormat.TWELVE_HOUR}`;
  const eventDateAndTime = dayjs(startTime).tz("America/Los_Angeles").locale("en").format(dateTimeFormat);
  return eventDateAndTime;
}

function convertToPlainText(markdownText: string) {
  const mardownNoBrs = markdownText.replaceAll("<br>", "\n");
  const plaintext = marked.use(markedPlaintify({
    link: (tokens) => `${tokens.text} (at ${tokens.href})`,
  })).parse(mardownNoBrs);
  return plaintext;
}

async function icsAttachmentFor(calEvent: CalendarEvent, isAttendee: boolean, isCancelled: boolean): Promise<IcalEvent> {
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
    }
}

function whoHtml(calEvent: CalendarEvent) {
  const links = calEvent.attendees.map(person => personMailToLink(person));
  links.push(personMailToLink(calEvent.organizer));
  const html = links.join("<br/>");
  return html;
}

function personMailToLink(person: Person) {
  return `<a href="mailto:${person.email}">${person.name || person.email}</a>`;
}
