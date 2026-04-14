
import { Component } from '@angular/core';
import axios from 'axios';

@Component({
  selector: 'app-root',
  template: `
    <h2>Health AI</h2>
    <input [(ngModel)]="msg">
    <button (click)="send()">Enviar</button>
    <pre>{{res}}</pre>
  `
})
export class AppComponent {
  msg = '';
  res = '';

  async send() {
    const token = localStorage.getItem('token');
    const r = await axios.post('http://localhost:3000/chat',
      { message: this.msg },
      { headers: { Authorization: 'Bearer ' + token } }
    );
    this.res = JSON.stringify(r.data, null, 2);
  }
}
