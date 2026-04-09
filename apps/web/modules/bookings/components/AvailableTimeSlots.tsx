import dayjs from "@calcom/dayjs";
import { useBookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import type { IUseBookingLoadingStates } from "@calcom/features/bookings/Booker/components/hooks/useBookings";
import { getQueryParam } from "@calcom/features/bookings/Booker/utils/query-param";
import type { BookerEvent, Slots } from "@calcom/features/bookings/types";
import type { Slot } from "@calcom/features/schedules/lib/use-schedule/types";
import { useNonEmptyScheduleDays } from "@calcom/features/schedules/lib/use-schedule/useNonEmptyScheduleDays";
import { useSlotsForAvailableDates } from "@calcom/features/schedules/lib/use-schedule/useSlotsForDate";
import { localStorage } from "@calcom/lib/webstorage";
import { BookerLayouts } from "@calcom/prisma/zod-utils";
import classNames from "@calcom/ui/classNames";
import {
  AvailableTimes,
  AvailableTimesSkeleton,
} from "@calcom/web/modules/bookings/components/AvailableTimes";
import { AvailableTimesHeader } from "@calcom/web/modules/bookings/components/AvailableTimesHeader";
import { useCallback, useMemo, useRef } from "react";

type AvailableTimeSlotsProps = {
  extraDays?: number;
  limitHeight?: boolean;
  slots?: Slots;
  isLoading: boolean;
  seatsPerTimeSlot?: number | null;
  showAvailableSeatsCount?: boolean | null;
  event: {
    data?: Pick<BookerEvent, "length" | "bookingFields" | "price" | "currency" | "metadata"> | null;
  };
  customClassNames?: {
    availableTimeSlotsContainer?: string;
    availableTimeSlotsTitle?: string;
    availableTimeSlotsHeaderContainer?: string;
    availableTimeSlotsTimeFormatToggle?: string;
    availableTimes?: string;
  };
  confirmStepClassNames?: {
    confirmButton?: string;
  };
  loadingStates: IUseBookingLoadingStates;
  isVerificationCodeSending: boolean;
  renderConfirmNotVerifyEmailButtonCond: boolean;
  onSubmit: (timeSlot?: string) => void;
  skipConfirmStep: boolean;
  shouldRenderCaptcha?: boolean;
  watchedCfToken?: string;
  /**
   * This is the list of time slots that are unavailable to book
   */
  unavailableTimeSlots: string[];
  confirmButtonDisabled?: boolean;
  onAvailableTimeSlotSelect: (time: string) => void;
  hideAvailableTimesHeader?: boolean;
};

/**
 * Renders available time slots for a given date.
 * It will extract the date from the booker store.
 * Next to that you can also pass in the `extraDays` prop, this
 * will also fetch the next `extraDays` days and show multiple days
 * in columns next to each other.
 */

export const AvailableTimeSlots = ({
  extraDays,
  limitHeight,
  showAvailableSeatsCount,
  slots,
  isLoading,
  customClassNames,
  skipConfirmStep,
  seatsPerTimeSlot,
  onSubmit,
  unavailableTimeSlots,
  confirmButtonDisabled,
  confirmStepClassNames,
  onAvailableTimeSlotSelect,
  hideAvailableTimesHeader = false,
  ...props
}: AvailableTimeSlotsProps) => {
  const selectedDate = useBookerStoreContext((state) => state.selectedDate);

  const setSeatedEventData = useBookerStoreContext((state) => state.setSeatedEventData);
  const date = selectedDate || dayjs().format("YYYY-MM-DD");
  const [layout] = useBookerStoreContext((state) => [state.layout]);
  const isColumnView = layout === BookerLayouts.COLUMN_VIEW;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { setTentativeSelectedTimeslots } = useBookerStoreContext((state) => ({
    setTentativeSelectedTimeslots: state.setTentativeSelectedTimeslots,
    tentativeSelectedTimeslots: state.tentativeSelectedTimeslots,
  }));

  const onTentativeTimeSelect = ({
    time,
    attendees: _attendees,
    seatsPerTimeSlot: _seatsPerTimeSlot,
    bookingUid: _bookingUid,
  }: {
    time: string;
    attendees: number;
    seatsPerTimeSlot?: number | null;
    bookingUid?: string;
  }) => {
    // We don't intentionally invalidate schedule here because that could remove the slot itself that was clicked, causing a bad UX.
    // We could start doing that after we fix this behaviour.
    // schedule?.invalidate();

    // Earlier we had multiple tentative slots, but now we can only have one tentative slot.
    setTentativeSelectedTimeslots([time]);
  };

  const nonEmptyScheduleDays = useNonEmptyScheduleDays(slots);
  const nonEmptyScheduleDaysFromSelectedDate = nonEmptyScheduleDays.filter(
    (slot) => dayjs(selectedDate).diff(slot, "day") <= 0
  );

  // Creates an array of dates to fetch slots for.
  // If `extraDays` is passed in, we will extend the array with the next `extraDays` days.
  const dates = useMemo(() => {
    if (!extraDays) return [date];
    if (nonEmptyScheduleDaysFromSelectedDate.length > 0) {
      return nonEmptyScheduleDaysFromSelectedDate.slice(0, extraDays);
    }
    return [];
  }, [date, extraDays, nonEmptyScheduleDaysFromSelectedDate]);

  const { slotsPerDay, toggleConfirmButton } = useSlotsForAvailableDates(dates, slots);

  const overlayCalendarToggled =
    getQueryParam("overlayCalendar") === "true" || localStorage.getItem("overlayCalendarSwitchDefault");

  const onTimeSelect = useCallback(
    (time: string, attendees: number, seatsPerTimeSlot?: number | null, bookingUid?: string) => {
      setTentativeSelectedTimeslots([]);
      // note(Lauris): setting setSeatedEventData before setSelectedTimeslot so that in useSlots we have seated event data available
      // and only then we invoke handleReserveSlot that is triggered by the changes in setSelectedTimeslot.
      if (seatsPerTimeSlot) {
        setSeatedEventData({
          seatsPerTimeSlot,
          attendees,
          bookingUid,
          showAvailableSeatsCount,
        });
      }

      onAvailableTimeSlotSelect(time);

      const isTimeSlotAvailable = !unavailableTimeSlots.includes(time);
      if (skipConfirmStep && isTimeSlotAvailable) {
        onSubmit(time);
      }
      return;
    },
    [
      onSubmit,
      setSeatedEventData,
      skipConfirmStep,
      showAvailableSeatsCount,
      unavailableTimeSlots,
      setTentativeSelectedTimeslots,
      onAvailableTimeSlotSelect,
    ]
  );

  const handleSlotClick = useCallback(
    (selectedSlot: Slot, isOverlapping: boolean) => {
      if ((overlayCalendarToggled && isOverlapping) || skipConfirmStep) {
        toggleConfirmButton(selectedSlot);
      } else {
        onTimeSelect(
          selectedSlot.time,
          selectedSlot?.attendees || 0,
          seatsPerTimeSlot,
          selectedSlot.bookingUid
        );
      }
    },
    [overlayCalendarToggled, onTimeSelect, seatsPerTimeSlot, skipConfirmStep, toggleConfirmButton]
  );

  return (
    <>
      <div
        className={classNames(
          `flex`,
          hideAvailableTimesHeader && "hidden",
          `${customClassNames?.availableTimeSlotsContainer}`
        )}>
        {isLoading ? (
          <div className="mb-3 h-8" />
        ) : (
          slotsPerDay.length > 0 &&
          slotsPerDay.map((slots) => {
            // Check if this day is OOO - since OOO is date-level, just check the first slot
            const isOOODay = slots.slots.length > 0 && slots.slots[0]?.away;
            return (
              <AvailableTimesHeader
                customClassNames={{
                  availableTimeSlotsHeaderContainer: customClassNames?.availableTimeSlotsHeaderContainer,
                  availableTimeSlotsTitle: customClassNames?.availableTimeSlotsTitle,
                  availableTimeSlotsTimeFormatToggle: customClassNames?.availableTimeSlotsTimeFormatToggle,
                }}
                key={slots.date}
                date={dayjs(slots.date)}
                showTimeFormatToggle={!isColumnView && !isOOODay}
                availableMonth={
                  dayjs(selectedDate).format("MM") !== dayjs(slots.date).format("MM")
                    ? dayjs(slots.date).format("MMM")
                    : undefined
                }
              />
            );
          })
        )}
      </div>

      <div
        ref={containerRef}
        className={classNames(
          limitHeight && "no-scrollbar grow overflow-auto md:h-[400px]",
          !limitHeight && "flex h-full w-full flex-row gap-4",
          `${customClassNames?.availableTimeSlotsContainer}`
        )}>
        {isLoading && // Shows exact amount of days as skeleton.
          Array.from({ length: 1 + (extraDays ?? 0) }).map((_, i) => <AvailableTimesSkeleton key={i} />)}
        {!isLoading &&
          slotsPerDay.length > 0 &&
          slotsPerDay.map((slots) => (
            <div key={slots.date} className="no-scrollbar overflow-x-hidden! h-full w-full overflow-y-auto">
              <AvailableTimes
                className={customClassNames?.availableTimeSlotsContainer}
                customClassNames={customClassNames?.availableTimes}
                showTimeFormatToggle={!isColumnView}
                onTimeSelect={onTimeSelect}
                onTentativeTimeSelect={onTentativeTimeSelect}
                unavailableTimeSlots={unavailableTimeSlots}
                slots={slots.slots}
                showAvailableSeatsCount={showAvailableSeatsCount}
                skipConfirmStep={skipConfirmStep}
                seatsPerTimeSlot={seatsPerTimeSlot}
                handleSlotClick={handleSlotClick}
                confirmButtonDisabled={confirmButtonDisabled}
                confirmStepClassNames={confirmStepClassNames}
                {...props}
              />
            </div>
          ))}
      </div>
    </>
  );
};
