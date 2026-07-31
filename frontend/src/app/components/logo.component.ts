import { Component, Input } from '@angular/core';

/** Iberia corporate logo (wordmark + isotype). */
@Component({
  selector: 'app-logo',
  standalone: true,
  template: `<img
    src="/iberia-logo.png"
    alt="Iberia"
    [height]="height"
    [style.height.px]="height"
    style="width: auto; display: block"
  />`,
})
export class LogoComponent {
  @Input() height = 30;
}
