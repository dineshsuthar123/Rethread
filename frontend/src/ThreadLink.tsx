import {
  Link as RouterLink,
  useNavigate,
  type LinkProps,
} from "react-router-dom";
import { flushSync } from "react-dom";
export function ThreadLink({ onClick, ...props }: LinkProps) {
  const navigate = useNavigate();
  return (
    <RouterLink
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey ||
          props.target === "_blank" ||
          document.documentElement.dataset.motion === "off" ||
          !document.startViewTransition
        )
          return;
        event.preventDefault();
        document.startViewTransition(() =>
          flushSync(() =>
            navigate(props.to, { replace: props.replace, state: props.state }),
          ),
        );
      }}
    />
  );
}
