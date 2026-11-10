import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登录 FLD CRM</CardTitle>
          <CardDescription>占位页面，登录接口在第 2 步接入</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input id="username" name="username" autoComplete="username" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {submitted && (
              <p className="text-sm text-muted-foreground">登录功能将在第 2 步实现。</p>
            )}
          </CardContent>
          <CardFooter className="flex items-center justify-between">
            <Link to="/" className="text-sm text-muted-foreground hover:underline">
              返回首页
            </Link>
            <Button type="submit">登录</Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
